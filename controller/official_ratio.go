package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"

	"github.com/gin-gonic/gin"
)

// Official vendor list prices, fetched from the same public sources the upstream
// ratio comparison already reads, and stored under their own option keys so the
// model catalog can print "official price" beside "platform price".
//
// This data never reaches billing. It is display-only: the platform price stays
// whatever ModelRatio says, and a stale or wrong official price can only make a
// discount badge wrong, never a charge.
//
// Two sources, merged in this order (later wins):
//
//  1. models.dev — a broad catalog of USD/1M costs across providers. Good
//     coverage of well-known model IDs, no knowledge of this project's naming.
//  2. The official ratio preset — a new-api-native library of billing
//     expressions whose coefficients are, by the v1 contract in
//     pkg/billingexpr/expr.md, the providers' published $/1M prices. It knows
//     the exact model names this project ships, including the parameterized and
//     reasoning-effort variants models.dev has never heard of, so it takes
//     precedence where both have an entry.
const (
	officialRatioSyncTimeout = 30 * time.Second
	// officialRatioPresetPath is the ratio_config document behind preset -100.
	// It currently serves billing expressions rather than flat ratios; both
	// shapes are handled below so the sync keeps working if that changes.
	officialRatioPresetPath = "/llm-metadata/api/newapi/ratio_config-v1-base.json"
	modelsDevAPIURL         = "https://" + modelsDevHost + modelsDevPath
	// officialRatioMaxRatio rejects absurd values before they reach the catalog.
	// A ratio of 1e5 is $200 per 1K tokens; anything past that is corrupt data,
	// not a price. Display-only hygiene, not a billing guard.
	officialRatioMaxRatio = 1e5
)

// officialRatioSourceResult is one source's contribution to a sync pass.
type officialRatioSourceResult struct {
	Name    string `json:"name"`
	Models  int    `json:"models"`
	Skipped int    `json:"skipped,omitempty"`
	Error   string `json:"error,omitempty"`
}

// officialRatioSyncResult is what a sync pass wrote, reported to the admin UI and
// to the scheduled task's run history.
type officialRatioSyncResult struct {
	ModelRatioCount      int                         `json:"model_ratio_count"`
	CompletionRatioCount int                         `json:"completion_ratio_count"`
	CacheRatioCount      int                         `json:"cache_ratio_count"`
	SyncedAt             int64                       `json:"synced_at"`
	Sources              []officialRatioSourceResult `json:"sources"`
}

// officialRatioSet is the in-flight merge target: the three ratio families keyed
// by model name.
type officialRatioSet struct {
	modelRatio      map[string]float64
	completionRatio map[string]float64
	cacheRatio      map[string]float64
}

func newOfficialRatioSet() *officialRatioSet {
	return &officialRatioSet{
		modelRatio:      make(map[string]float64),
		completionRatio: make(map[string]float64),
		cacheRatio:      make(map[string]float64),
	}
}

// put records one model's official ratios, dropping values that cannot describe
// a price. The input ratio must be positive — it is the denominator the other
// two are expressed against — while completion and cache ratios may legitimately
// be zero (free output tiers, free cache reads).
//
// A source that supplies the input ratio owns all three: the completion and cache
// ratios are multiples OF THAT source's input price, so any previously recorded
// ones are cleared first even when this source publishes no replacement. Merging
// them instead would combine one source's input price with another's multiplier
// and produce an output or cache price neither source ever published — e.g.
// models.dev's cache ratio 0.208955 was computed against input 0.0335, so keeping
// it after the preset raised input to 0.225 would advertise $0.094/M as the
// vendor's cache price.
func (set *officialRatioSet) put(modelName string, modelRatio float64, completionRatio, cacheRatio *float64) bool {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" || !isUsableOfficialRatio(modelRatio) || modelRatio <= 0 {
		return false
	}
	set.modelRatio[modelName] = roundRatioValue(modelRatio)

	delete(set.completionRatio, modelName)
	delete(set.cacheRatio, modelName)
	if completionRatio != nil && isUsableOfficialRatio(*completionRatio) {
		set.completionRatio[modelName] = roundRatioValue(*completionRatio)
	}
	if cacheRatio != nil && isUsableOfficialRatio(*cacheRatio) {
		set.cacheRatio[modelName] = roundRatioValue(*cacheRatio)
	}
	return true
}

func isUsableOfficialRatio(value float64) bool {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return false
	}
	return value >= 0 && value <= officialRatioMaxRatio
}

// SyncOfficialRatios refreshes the stored official prices on demand.
func SyncOfficialRatios(c *gin.Context) {
	result, err := runOfficialRatioSync(c.Request.Context())
	if err != nil {
		logger.LogError(c.Request.Context(), "official ratio sync failed: "+err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// runOfficialRatioSync fetches every source, merges them, and persists the
// result. A source that fails is reported and skipped rather than failing the
// pass, so one dead endpoint does not throw away the other's data. The pass only
// fails when no source produced a single model, which means there is nothing to
// write and overwriting the stored prices with an empty map would blank the
// catalog's official column.
func runOfficialRatioSync(ctx context.Context) (*officialRatioSyncResult, error) {
	ctx, cancel := context.WithTimeout(ctx, officialRatioSyncTimeout)
	defer cancel()

	client := newRatioSourceHTTPClient()
	merged := newOfficialRatioSet()
	sources := make([]officialRatioSourceResult, 0, 2)

	// Order matters: the preset runs last so its project-native model names win
	// over models.dev's provider-native ones.
	sources = append(sources, collectOfficialRatiosFromSource(ctx, client, modelsDevPresetName, modelsDevAPIURL, merged, parseModelsDevOfficialRatios))
	sources = append(sources, collectOfficialRatiosFromSource(ctx, client, officialRatioPresetName, officialRatioPresetBaseURL+officialRatioPresetPath, merged, parseRatioConfigOfficialRatios))

	if len(merged.modelRatio) == 0 {
		messages := make([]string, 0, len(sources))
		for _, source := range sources {
			if source.Error != "" {
				messages = append(messages, source.Name+": "+source.Error)
			}
		}
		if len(messages) == 0 {
			return nil, fmt.Errorf("官方价数据源未返回任何可用价格")
		}
		return nil, fmt.Errorf("官方价同步失败：%s", strings.Join(messages, "; "))
	}

	syncedAt := common.GetTimestamp()
	modelRatioJSON, err := common.Marshal(merged.modelRatio)
	if err != nil {
		return nil, err
	}
	completionRatioJSON, err := common.Marshal(merged.completionRatio)
	if err != nil {
		return nil, err
	}
	cacheRatioJSON, err := common.Marshal(merged.cacheRatio)
	if err != nil {
		return nil, err
	}

	// One transaction for all four keys: a partial write would leave completion
	// ratios describing a different snapshot than the model ratios they divide.
	if err := model.UpdateOptionsBulk(map[string]string{
		"OfficialModelRatio":      string(modelRatioJSON),
		"OfficialCompletionRatio": string(completionRatioJSON),
		"OfficialCacheRatio":      string(cacheRatioJSON),
		"OfficialRatioSyncedAt":   strconv.FormatInt(syncedAt, 10),
	}); err != nil {
		return nil, err
	}
	// The pricing payload embeds these ratios, and its cache holds for a minute.
	// Dropping it makes the sync visible on the next catalog load instead of
	// leaving the admin looking at the old official column.
	model.InvalidatePricingCache()

	return &officialRatioSyncResult{
		ModelRatioCount:      len(merged.modelRatio),
		CompletionRatioCount: len(merged.completionRatio),
		CacheRatioCount:      len(merged.cacheRatio),
		SyncedAt:             syncedAt,
		Sources:              sources,
	}, nil
}

// collectOfficialRatiosFromSource fetches one source and merges whatever it
// parsed into the shared set.
func collectOfficialRatiosFromSource(
	ctx context.Context,
	client *http.Client,
	name string,
	url string,
	target *officialRatioSet,
	parse func([]byte, *officialRatioSet) (int, int, error),
) officialRatioSourceResult {
	body, err := fetchOfficialRatioDocument(ctx, client, url)
	if err != nil {
		return officialRatioSourceResult{Name: name, Error: err.Error()}
	}
	added, skipped, err := parse(body, target)
	if err != nil {
		return officialRatioSourceResult{Name: name, Error: err.Error()}
	}
	return officialRatioSourceResult{Name: name, Models: added, Skipped: skipped}
}

// parseModelsDevOfficialRatios reuses the models.dev conversion the upstream
// comparison already performs: costs are USD/1M, and the existing converter
// already turns them into local ratio units and resolves the same model ID
// appearing under several providers.
func parseModelsDevOfficialRatios(body []byte, target *officialRatioSet) (int, int, error) {
	converted, err := convertModelsDevToRatioData(bytes.NewReader(body))
	if err != nil {
		return 0, 0, err
	}
	added, skipped := mergeRatioMapsIntoOfficialSet(
		valueMap(converted["model_ratio"]),
		valueMap(converted["completion_ratio"]),
		valueMap(converted["cache_ratio"]),
		target,
	)
	return added, skipped, nil
}

// parseRatioConfigOfficialRatios reads a new-api ratio_config document.
//
// The preset currently publishes billing expressions rather than flat ratios, so
// each expression is probed for the vendor prices its coefficients encode (see
// billingexpr.ProbeListPrices). Flat model_ratio / completion_ratio / cache_ratio
// maps are still read when present, because that is the documented shape of the
// endpoint and a future revision may go back to it; expressions win for a model
// that somehow carries both, since they are the more specific statement.
func parseRatioConfigOfficialRatios(body []byte, target *officialRatioSet) (int, int, error) {
	var envelope struct {
		Success bool            `json:"success"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := common.Unmarshal(body, &envelope); err != nil {
		return 0, 0, err
	}
	if !envelope.Success && len(envelope.Data) == 0 {
		if envelope.Message != "" {
			return 0, 0, fmt.Errorf("%s", envelope.Message)
		}
		return 0, 0, fmt.Errorf("ratio config response carried no data")
	}

	// Ratio maps are decoded as `any` per entry rather than float64: these
	// documents are published by a third party, and one model carrying a string
	// where a number belongs must cost that model its official price, not the
	// whole catalog's.
	var data struct {
		ModelRatio      map[string]any    `json:"model_ratio"`
		CompletionRatio map[string]any    `json:"completion_ratio"`
		CacheRatio      map[string]any    `json:"cache_ratio"`
		BillingMode     map[string]string `json:"billing_mode"`
		BillingExpr     map[string]string `json:"billing_expr"`
	}
	if err := common.Unmarshal(envelope.Data, &data); err != nil {
		return 0, 0, err
	}

	added, skipped := mergeRatioMapsIntoOfficialSet(
		data.ModelRatio,
		data.CompletionRatio,
		data.CacheRatio,
		target,
	)

	for modelName, exprStr := range data.BillingExpr {
		if mode, ok := data.BillingMode[modelName]; ok && mode != billing_setting.BillingModeTieredExpr {
			continue
		}
		if strings.TrimSpace(exprStr) == "" {
			continue
		}
		prices, err := billingexpr.ProbeListPrices(exprStr)
		if err != nil {
			skipped++
			continue
		}
		// ratio 1 == $0.002 / 1K == $2 / 1M, and the other two ratios are
		// multiples of the input price.
		modelRatio := prices.Input / 2
		completionRatio := prices.Output / prices.Input
		var cacheRatio *float64
		if prices.HasCacheRead {
			value := prices.CacheRead / prices.Input
			cacheRatio = &value
		}
		if target.put(modelName, modelRatio, &completionRatio, cacheRatio) {
			added++
		} else {
			skipped++
		}
	}

	return added, skipped, nil
}

func mergeRatioMapsIntoOfficialSet(
	modelRatios map[string]any,
	completionRatios map[string]any,
	cacheRatios map[string]any,
	target *officialRatioSet,
) (added int, skipped int) {
	for modelName, rawModelRatio := range modelRatios {
		modelRatio, ok := asFloat64(rawModelRatio)
		if !ok {
			skipped++
			continue
		}
		completionRatio := optionalOfficialRatio(completionRatios, modelName)
		cacheRatio := optionalOfficialRatio(cacheRatios, modelName)
		if target.put(modelName, modelRatio, completionRatio, cacheRatio) {
			added++
		} else {
			skipped++
		}
	}
	return added, skipped
}

func optionalOfficialRatio(ratios map[string]any, modelName string) *float64 {
	raw, exists := ratios[modelName]
	if !exists {
		return nil
	}
	value, ok := asFloat64(raw)
	if !ok {
		return nil
	}
	return &value
}

func fetchOfficialRatioDocument(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, maxRatioConfigBytes))
}
