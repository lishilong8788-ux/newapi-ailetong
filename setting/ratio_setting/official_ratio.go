package ratio_setting

import (
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/types"
)

// Official vendor list prices, stored as ratios in exactly the same unit as
// ModelRatio / CompletionRatio / CacheRatio (ratio 1 == $0.002 per 1K tokens),
// so the pricing page can render "official price" next to "platform price" with
// one formula instead of two.
//
// These maps are display-only and deliberately separated from the billing
// ratios above. Nothing in the relay or quota path reads them: a wrong value
// here misprints a discount badge on the model catalog, it can never change
// what a request costs. They are also excluded from GetExposedData(), because
// /api/ratio_config publishes what THIS site charges — mixing vendor list
// prices into it would let a downstream instance sync our display data in as
// its own billing ratios.
//
// The maps are populated by the official-price sync (controller/official_ratio.go)
// and persisted through the OfficialModelRatio / OfficialCompletionRatio /
// OfficialCacheRatio option keys.
var (
	officialModelRatioMap      = types.NewRWMap[string, float64]()
	officialCompletionRatioMap = types.NewRWMap[string, float64]()
	officialCacheRatioMap      = types.NewRWMap[string, float64]()
)

// officialRatioAutoSyncEnabled gates the daily scheduled sync. Default off: the
// sync reaches out to public pricing endpoints, and an upgrade should not start
// making outbound requests on its own. Admins turn it on next to the manual
// "sync official prices" button.
var officialRatioAutoSyncEnabled atomic.Bool

// officialRatioSyncedAt is the unix second of the last successful sync, surfaced
// so the settings page can say how stale the official column is.
var officialRatioSyncedAt atomic.Int64

func SetOfficialRatioAutoSyncEnabled(enabled bool) {
	officialRatioAutoSyncEnabled.Store(enabled)
}

func IsOfficialRatioAutoSyncEnabled() bool {
	return officialRatioAutoSyncEnabled.Load()
}

func SetOfficialRatioSyncedAt(timestamp int64) {
	officialRatioSyncedAt.Store(timestamp)
}

func GetOfficialRatioSyncedAt() int64 {
	return officialRatioSyncedAt.Load()
}

func OfficialModelRatio2JSONString() string {
	return officialModelRatioMap.MarshalJSONString()
}

func OfficialCompletionRatio2JSONString() string {
	return officialCompletionRatioMap.MarshalJSONString()
}

func OfficialCacheRatio2JSONString() string {
	return officialCacheRatioMap.MarshalJSONString()
}

func UpdateOfficialModelRatioByJSONString(jsonStr string) error {
	return loadOfficialRatioMap(officialModelRatioMap, jsonStr)
}

func UpdateOfficialCompletionRatioByJSONString(jsonStr string) error {
	return loadOfficialRatioMap(officialCompletionRatioMap, jsonStr)
}

func UpdateOfficialCacheRatioByJSONString(jsonStr string) error {
	return loadOfficialRatioMap(officialCacheRatioMap, jsonStr)
}

// loadOfficialRatioMap treats a blank option value as "no official prices yet"
// rather than an error. A fresh install has never run the sync, so the option
// row is absent or empty, and the billing ratio loaders' behaviour of failing on
// "" would log a startup error for a state that is entirely normal here.
func loadOfficialRatioMap(target *types.RWMap[string, float64], jsonStr string) error {
	if strings.TrimSpace(jsonStr) == "" {
		target.Clear()
		return nil
	}
	return types.LoadFromJsonString(target, jsonStr)
}

// GetOfficialModelRatio returns the vendor list-price ratio for a model. The
// name goes through FormatMatchingModelName so a parameterized model resolves
// to the same key its platform ratio does — otherwise the two price columns
// would silently key on different names and the discount would compare a
// concrete model against nothing.
func GetOfficialModelRatio(name string) (float64, bool) {
	return officialModelRatioMap.Get(FormatMatchingModelName(name))
}

func GetOfficialCompletionRatio(name string) (float64, bool) {
	return officialCompletionRatioMap.Get(FormatMatchingModelName(name))
}

func GetOfficialCacheRatio(name string) (float64, bool) {
	return officialCacheRatioMap.Get(FormatMatchingModelName(name))
}

// Deliberately no GetOfficial*RatioCopy accessors mirroring the billing ratios'.
// Those exist to feed GetExposedData(); these maps are excluded from it by design
// (see the note at the top of this file), so a copy accessor would only be an
// unused door into display data.
