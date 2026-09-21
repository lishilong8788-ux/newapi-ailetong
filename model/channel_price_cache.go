package model

import (
	"math"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// Per-channel sell-price metadata, parsed once per channel-cache sync and read
// under channelSyncLock alongside the rest of the cache.
//
// Both maps exist so neither the public per-channel pricing endpoint nor the
// price-ranked router has to touch `channels.settings` JSON on a request. The
// parse deliberately does NOT go through Channel.GetOtherSettings(): that helper
// rewrites and SAVES the row when the JSON fails to unmarshal, and a cache
// rebuild is the wrong place to start writing to the channels table.
var (
	channel2priceSettings map[int]*dto.ChannelPriceSettings
	channel2modelMapping  map[int]map[string]string
	// model2channelPriceRank maps a client-facing model name to a synthetic
	// priority per channel, cheapest channel highest. Absent entry means "this
	// model has no usable price spread", and selection falls back to the
	// operator's manual priority — see buildChannelPriceRanks.
	model2channelPriceRank map[string]map[int]int64
)

// PRICE_RANK_UNRESOLVED is the tier every channel whose sell price cannot be
// resolved lands in. It is below every rank handed to a priced channel, so an
// unpriced channel is never reached before a priced one — the whole feature
// would be a foot-gun otherwise: "cheapest first" must not mean "unknown first".
const priceRankUnresolved int64 = 0

// ChannelPrice is what one channel charges for one model on the sell side.
//
// Ratios, not formatted prices: the catalog frontend already turns a
// model/completion/cache ratio triple into currency, per token unit, in the
// viewer's currency. Returning ratios lets the per-channel card reuse that
// pipeline verbatim instead of growing a second price formatter that drifts.
//
// Completion and cache are pointers because "the vendor published no output
// rate" and "output is free" are different claims, and only the first should
// render as `-`.
//
// QuotaType splits the struct in two the same way Pricing does for a catalog
// row: a per-call model has no token rate at all, so ModelRatio stays 0 and
// ModelPrice carries the figure. Publishing a ratio for it would advertise a
// per-token price the relay never charges.
type ChannelPrice struct {
	// UpstreamModel is the model name this channel actually sends upstream,
	// after model_mapping. The discount chain and the official price table are
	// both keyed on it.
	UpstreamModel string `json:"upstream_model,omitempty"`
	// Discount is the configured fraction of the vendor list price, nil when
	// none resolved. Nil is not 1.0: at 1.0 an operator declared "list price",
	// nil means nobody declared anything.
	Discount *float64 `json:"discount,omitempty"`
	// Source is dto.PriceSource*: which rung of the chain produced Discount, or
	// fallback when the ratios below are the platform's own.
	Source          string   `json:"price_source"`
	ModelRatio      float64  `json:"model_ratio"`
	CompletionRatio *float64 `json:"completion_ratio,omitempty"`
	CacheRatio      *float64 `json:"cache_ratio,omitempty"`
	// QuotaType mirrors Pricing.QuotaType: 0 per token, 1 per call. Omitted for
	// the token case so every existing row keeps its payload byte-for-byte.
	QuotaType int `json:"quota_type,omitempty"`
	// ModelPrice is USD per call, only meaningful at QuotaType 1. Not omitempty:
	// mj_inpaint is configured at 0 and a free call is a price, not a missing one.
	ModelPrice float64 `json:"model_price"`
	// PriceUnset reports that no price of either kind exists — neither a
	// discount, nor a per-call price, nor a platform ratio — so both figures
	// above are meaningless and must render as `-` rather than as a price.
	PriceUnset bool `json:"price_unset,omitempty"`
}

// quotaTypePerRequest is Pricing.QuotaType's per-call value. Kept in step with
// model/pricing.go on purpose: the channel card and the catalog row it sits
// under must not disagree about how a model is billed.
const quotaTypePerRequest = 1

// ChannelRoute is one channel that can serve one model, with everything the
// public catalog is allowed to know about it.
//
// Deliberately absent: the channel key, base URL, upstream cost, margin, and
// anything from channel_cost_daily. This struct feeds an endpoint that answers
// to unauthenticated visitors when the pricing page is public, so it carries
// sell-side facts only. Name is filled in by the controller for admins alone —
// a channel name is frequently the supplier's identity.
type ChannelRoute struct {
	ChannelID int    `json:"channel_id"`
	Name      string `json:"name,omitempty"`
	// Code is the short line label ("hs4"), taken from the model_mapping target
	// suffix. Empty when the mapping carries no suffix; the frontend falls back
	// to the channel id rather than printing the channel name.
	Code string `json:"code,omitempty"`
	// Category is a coarse slug (public_cloud / aggregator / vendor / self_hosted
	// / other) the frontend localizes. The raw channel type stays server-side:
	// the category is as much as a catalog visitor needs, and the exact adaptor
	// names the upstream provider.
	Category string `json:"category"`
	// LatencyMs is the last channel test round-trip, 0 when never tested.
	LatencyMs int `json:"latency_ms,omitempty"`
	// Groups are the viewer-reachable groups this channel serves the model in.
	Groups []string     `json:"groups,omitempty"`
	Price  ChannelPrice `json:"price"`
	// priority is the operator's manual channel priority, kept unexported: it is
	// used to order rows that tie on price and must not reach the client.
	priority int64
}

// channelCategories groups channel types the way a buyer reads a supply chain,
// not the way the relay reads an adaptor. Anything unlisted answers "other",
// which is honest for the long tail of one-off integrations.
var channelCategories = map[int]string{
	// 模型原厂：模型的开发者自己提供的 API
	constant.ChannelTypeOpenAI:      channelCategoryVendor,
	constant.ChannelTypeOpenAIMax:   channelCategoryVendor,
	constant.ChannelTypeAnthropic:   channelCategoryVendor,
	constant.ChannelTypeGemini:      channelCategoryVendor,
	constant.ChannelTypePaLM:        channelCategoryVendor,
	constant.ChannelTypeDeepSeek:    channelCategoryVendor,
	constant.ChannelTypeMoonshot:    channelCategoryVendor,
	constant.ChannelTypeZhipu:       channelCategoryVendor,
	constant.ChannelTypeZhipu_v4:    channelCategoryVendor,
	constant.ChannelTypeXai:         channelCategoryVendor,
	constant.ChannelTypeMistral:     channelCategoryVendor,
	constant.ChannelTypeCohere:      channelCategoryVendor,
	constant.ChannelTypeMiniMax:     channelCategoryVendor,
	constant.ChannelTypeMiniMaxH3:   channelCategoryVendor,
	constant.ChannelTypeLingYiWanWu: channelCategoryVendor,
	constant.ChannelTypePerplexity:  channelCategoryVendor,
	constant.ChannelTypeMokaAI:      channelCategoryVendor,
	constant.ChannelTypeJina:        channelCategoryVendor,
	constant.ChannelTypeKling:       channelCategoryVendor,
	constant.ChannelTypeVidu:        channelCategoryVendor,
	constant.ChannelTypeSora:        channelCategoryVendor,
	constant.ChannelTypeCodex:       channelCategoryVendor,
	constant.ChannelTypeMidjourney:  channelCategoryVendor,
	constant.ChannelTypeSunoAPI:     channelCategoryVendor,
	constant.ChannelTypeCoze:        channelCategoryVendor,
	constant.ChannelTypeDify:        channelCategoryVendor,

	// 公有云：云厂商托管的模型服务
	constant.ChannelTypeAzure:       channelCategoryPublicCloud,
	constant.ChannelTypeAws:         channelCategoryPublicCloud,
	constant.ChannelTypeVertexAi:    channelCategoryPublicCloud,
	constant.ChannelTypeAli:         channelCategoryPublicCloud,
	constant.ChannelTypeBaidu:       channelCategoryPublicCloud,
	constant.ChannelTypeBaiduV2:     channelCategoryPublicCloud,
	constant.ChannelTypeTencent:     channelCategoryPublicCloud,
	constant.ChannelTypeVolcEngine:  channelCategoryPublicCloud,
	constant.ChannelTypeDoubaoVideo: channelCategoryPublicCloud,
	constant.ChannelTypeJimeng:      channelCategoryPublicCloud,
	constant.ChannelTypeXunfei:      channelCategoryPublicCloud,
	constant.ChannelType360:         channelCategoryPublicCloud,
	constant.ChannelCloudflare:      channelCategoryPublicCloud,
	constant.ChannelTypeSiliconFlow: channelCategoryPublicCloud,
	constant.ChannelTypeReplicate:   channelCategoryPublicCloud,
	constant.ChannelTypeSubmodel:    channelCategoryPublicCloud,

	// 聚合平台：转售多家模型的中转/聚合服务
	constant.ChannelTypeOpenRouter:     channelCategoryAggregator,
	constant.ChannelTypeOhMyGPT:        channelCategoryAggregator,
	constant.ChannelTypeAIProxy:        channelCategoryAggregator,
	constant.ChannelTypeAIProxyLibrary: channelCategoryAggregator,
	constant.ChannelTypeAPI2GPT:        channelCategoryAggregator,
	constant.ChannelTypeAIGC2D:         channelCategoryAggregator,
	constant.ChannelTypeAILS:           channelCategoryAggregator,
	constant.ChannelTypeMidjourneyPlus: channelCategoryAggregator,
	constant.ChannelTypeNewAPI:         channelCategoryAggregator,
	constant.ChannelTypeSub2API:        channelCategoryAggregator,
	constant.ChannelTypeFastGPT:        channelCategoryAggregator,

	// 自建：跑在自己机器上的推理服务
	constant.ChannelTypeOllama:     channelCategorySelfHosted,
	constant.ChannelTypeXinference: channelCategorySelfHosted,
}

const (
	channelCategoryVendor      = "vendor"
	channelCategoryPublicCloud = "public_cloud"
	channelCategoryAggregator  = "aggregator"
	channelCategorySelfHosted  = "self_hosted"
	channelCategoryOther       = "other"
)

func channelCategoryOf(channelType int) string {
	if category, ok := channelCategories[channelType]; ok {
		return category
	}
	return channelCategoryOther
}

// resolveUpstreamModel follows the same chained model_mapping the relay does
// (relay/helper/model_mapped.go), including its cycle guard. A cycle returns the
// original name: the relay would reject the request outright, and pricing a name
// we know is unusable is worse than pricing the one the catalog advertises.
func resolveUpstreamModel(mapping map[string]string, clientModel string) string {
	if len(mapping) == 0 {
		return clientModel
	}
	current := clientModel
	visited := map[string]bool{current: true}
	for {
		mapped, exists := mapping[current]
		if !exists || mapped == "" {
			return current
		}
		if visited[mapped] {
			if mapped == current {
				return current
			}
			return clientModel
		}
		visited[mapped] = true
		current = mapped
	}
}

// lineCodeOf extracts the short line label from an upstream model name.
//
// Operators distinguish lines by suffixing the mapping target
// ("deepseek-v4-pro-0813/hs4"), so the suffix is the label the catalog should
// print. Only a mapped name yields one: an unmapped model's own name carrying a
// slash is a vendor-namespaced model ("qwen/qwen3"), and "qwen3" is not a line.
func lineCodeOf(clientModel string, upstreamModel string) string {
	if upstreamModel == "" || upstreamModel == clientModel {
		return ""
	}
	idx := strings.LastIndex(upstreamModel, "/")
	if idx < 0 || idx == len(upstreamModel)-1 {
		return ""
	}
	// Only when the part before the slash is the model we started from; anything
	// else is a rename rather than a line suffix.
	if strings.TrimSuffix(upstreamModel[:idx], "/") != clientModel {
		return ""
	}
	return upstreamModel[idx+1:]
}

// resolveChannelPrice prices one model on one channel for display and ranking.
//
// Three outcomes, and conflating any two of them is the bug this function exists
// to prevent:
//
//   - A resolved discount: the price is the VENDOR LIST price scaled by the
//     discount, so the advertised 4.4折 is arithmetic the reader can check. All
//     three official coefficients move together for the reason spelled out in
//     service.ComputeListPriceQuota — keeping the platform's completion_ratio
//     while swapping model_ratio would make the realized output discount
//     discount × (platformCompletion / officialCompletion).
//   - No resolved discount: the price is the PLATFORM's own ratio, flagged
//     fallback. That is what billing actually charges today, so it is the honest
//     number; inventing a discount for it would advertise a cut nobody
//     configured.
//
// A per-call model short-circuits both: ModelPriceHelper consults
// ratio_setting.GetModelPrice first and never looks at a ratio when it hits, so
// a discount against a token list price is not what the relay charges. Pricing
// it as official × discount would print a per-token number for a model billed
// per request.
//
// group_ratio is absent from every branch. The channel tier is a property of
// the line, not of who is asking, and the group multiplier is already shown by
// the per-group cards next to these.
func resolveChannelPrice(price *dto.ChannelPriceSettings, clientModel string, mapping map[string]string) ChannelPrice {
	upstreamModel := resolveUpstreamModel(mapping, clientModel)
	result := ChannelPrice{UpstreamModel: upstreamModel}

	// Keyed on the CLIENT name, matching billing: ModelPriceHelper prices
	// info.OriginModelName, which is the name before model_mapping. The discount
	// chain below is keyed on the upstream name instead because that is the key
	// space an operator configures per-channel overrides in.
	if modelPrice, found := ratio_setting.GetModelPrice(clientModel, false); found && validRatio(modelPrice) {
		// Source stays fallback and Discount stays nil even when the channel has a
		// discount configured: nothing scaled this figure, and a discount badge over
		// an untouched price is the exact claim this function exists to avoid.
		result.Source = dto.PriceSourceFallback
		result.QuotaType = quotaTypePerRequest
		result.ModelPrice = modelPrice
		return result
	}

	discount, source, ok := price.ResolveDiscount(upstreamModel)
	result.Source = source

	if ok {
		if officialModel, found := ratio_setting.GetOfficialModelRatio(upstreamModel); found && validRatio(officialModel) && officialModel > 0 {
			result.Discount = &discount
			result.ModelRatio = officialModel * discount
			if officialCompletion, hasCompletion := ratio_setting.GetOfficialCompletionRatio(upstreamModel); hasCompletion && validRatio(officialCompletion) {
				result.CompletionRatio = &officialCompletion
			}
			if officialCache, hasCache := ratio_setting.GetOfficialCacheRatio(upstreamModel); hasCache && validRatio(officialCache) {
				result.CacheRatio = &officialCache
			}
			return result
		}
		// A discount with no list price to apply it to cannot produce a number.
		// Report the platform price and say fallback: the alternative is printing
		// a discount badge over a price the discount never touched.
		result.Source = dto.PriceSourceFallback
	}

	platformRatio, ratioFound, _ := ratio_setting.GetModelRatio(clientModel)
	result.ModelRatio = platformRatio
	result.PriceUnset = !ratioFound
	if completion := ratio_setting.GetCompletionRatio(clientModel); validRatio(completion) {
		result.CompletionRatio = &completion
	}
	if cache, hasCache := ratio_setting.GetCacheRatio(clientModel); hasCache && validRatio(cache) {
		result.CacheRatio = &cache
	}
	return result
}

func validRatio(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0
}

// parseChannelPriceMetadata pulls the price settings and the model mapping off
// one channel row.
//
// It unmarshals `settings` directly rather than calling GetOtherSettings(),
// which saves the row back when the JSON is malformed. A cache rebuild must stay
// read-only against the channels table; a channel with broken JSON simply has no
// discount, which is the same state as a channel that never configured one.
func parseChannelPriceMetadata(channel *Channel) (*dto.ChannelPriceSettings, map[string]string) {
	var price *dto.ChannelPriceSettings
	if strings.TrimSpace(channel.OtherSettings) != "" {
		settings := dto.ChannelOtherSettings{}
		if err := common.UnmarshalJsonStr(channel.OtherSettings, &settings); err == nil {
			price = settings.Price
		}
	}

	var mapping map[string]string
	if raw := strings.TrimSpace(channel.GetModelMapping()); raw != "" && raw != "{}" {
		parsed := make(map[string]string)
		if err := common.UnmarshalJsonStr(raw, &parsed); err == nil && len(parsed) > 0 {
			mapping = parsed
		}
	}

	return price, mapping
}

// buildChannelPriceRanks turns resolved sell prices into synthetic priorities,
// one map per client-facing model, cheapest channel highest.
//
// Why precomputed: GetRandomSatisfiedChannel runs on every relay request while
// holding channelSyncLock, and resolving a price means walking a discount chain
// plus three ratio lookups per candidate. That work belongs to the sync, not to
// the request.
//
// A model is only ranked when its channels have at least two DISTINCT price
// tiers. With one tier there is nothing to order — every candidate is equal —
// and emitting a flat rank map would collapse the operator's manual priority
// tiers into one, silently turning failover into a single weighted pool. Those
// models are left absent so selection falls back to the manual priority
// untouched, which is also what makes "nobody configured any discount" safe.
//
// Channels whose price cannot be resolved land in priceRankUnresolved, strictly
// below every priced channel: the feature promises cheapest-first, and an unknown
// price is not a cheap price.
//
// Per-call models are excluded from the comparison for a different reason: a
// USD-per-request figure and a per-token ratio are different units, and sorting
// them into one ascending sequence would answer "is $0.02 per call cheaper than
// ratio 3" — a question with no meaning. Since the per-call price is keyed on the
// model name, every channel serving that model resolves the same figure anyway,
// so the model ends up with one tier and keeps the manual priority.
func buildChannelPriceRanks(
	channels []*Channel,
	priceSettings map[int]*dto.ChannelPriceSettings,
	modelMappings map[int]map[string]string,
) map[string]map[int]int64 {
	// model -> channel -> resolved price, plus the channels left out of the
	// comparison per model.
	type modelPrices struct {
		byChannel map[int]float64
		unranked  []int
	}
	perModel := make(map[string]*modelPrices)

	for _, channel := range channels {
		if channel.Status != common.ChannelStatusEnabled {
			continue
		}
		price := priceSettings[channel.Id]
		mapping := modelMappings[channel.Id]
		for _, modelName := range strings.Split(channel.Models, ",") {
			modelName = strings.TrimSpace(modelName)
			if modelName == "" {
				continue
			}
			entry, ok := perModel[modelName]
			if !ok {
				entry = &modelPrices{byChannel: make(map[int]float64)}
				perModel[modelName] = entry
			}
			resolved := resolveChannelPrice(price, modelName, mapping)
			// A per-call price is a known price in the wrong unit for this
			// sequence, so it is held out explicitly rather than by relying on
			// the discount test below happening to reject it today.
			if resolved.QuotaType == quotaTypePerRequest {
				entry.unranked = append(entry.unranked, channel.Id)
				continue
			}
			// Only a real discount produces a comparable number. A fallback row
			// is the platform price, which is the same figure for every channel
			// serving the model and therefore carries no ordering information —
			// treating it as a price would rank channels by a constant.
			if resolved.Discount == nil || resolved.ModelRatio <= 0 {
				entry.unranked = append(entry.unranked, channel.Id)
				continue
			}
			entry.byChannel[channel.Id] = resolved.ModelRatio
		}
	}

	ranks := make(map[string]map[int]int64)
	for modelName, entry := range perModel {
		distinct := distinctSortedPrices(entry.byChannel)
		// Tier count includes the unresolved tier when it is occupied: one priced
		// channel plus one unranked channel is a real ordering decision.
		tiers := len(distinct)
		if len(entry.unranked) > 0 {
			tiers++
		}
		if tiers < 2 {
			continue
		}

		// Cheapest gets the highest rank; GetRandomSatisfiedChannel sorts
		// priorities descending and walks down one tier per retry.
		rankOfPrice := make(map[float64]int64, len(distinct))
		for i, price := range distinct {
			rankOfPrice[price] = int64(len(distinct) - i)
		}

		modelRanks := make(map[int]int64, len(entry.byChannel)+len(entry.unranked))
		for channelID, price := range entry.byChannel {
			modelRanks[channelID] = rankOfPrice[price]
		}
		for _, channelID := range entry.unranked {
			modelRanks[channelID] = priceRankUnresolved
		}
		ranks[modelName] = modelRanks
	}
	return ranks
}

// priceRankEpsilon is the granularity two sell prices must differ by to occupy
// different tiers. Ratios are float products of a list price and a discount, so
// exact equality is not a safe test: two channels an operator gave the same
// discount must share a tier and load-balance by weight, not split into a
// primary and a failover by a rounding artefact. 1e-9 is far below the smallest
// meaningful price difference (a ratio of 1 is $0.002 per 1K tokens).
const priceRankEpsilon = 1e-9

func distinctSortedPrices(byChannel map[int]float64) []float64 {
	prices := make([]float64, 0, len(byChannel))
	for _, price := range byChannel {
		prices = append(prices, price)
	}
	sort.Float64s(prices)

	distinct := make([]float64, 0, len(prices))
	for _, price := range prices {
		if len(distinct) == 0 || price-distinct[len(distinct)-1] > priceRankEpsilon {
			distinct = append(distinct, price)
		}
	}
	return distinct
}

// channelPriceRankFor answers the synthetic priority of one channel for one
// model, and whether this model is price-ranked at all. Caller must hold
// channelSyncLock (read lock).
func channelPriceRankFor(modelName string, channelID int) (int64, bool) {
	ranks, ok := model2channelPriceRank[modelName]
	if !ok {
		return 0, false
	}
	rank, ok := ranks[channelID]
	if !ok {
		// The model is ranked but this channel is not in the map — it was added
		// between syncs. Bottom tier rather than absent: a channel with no known
		// price must not preempt one with a known cheap price.
		return priceRankUnresolved, true
	}
	return rank, true
}

// channelRouteRow is the snapshot taken while channelSyncLock is held. Price
// resolution happens after the lock is released: it reads ratio_setting maps
// that take their own locks, and holding the channel cache lock across that is
// how the deadlock in the pricing cache got written the first time.
type channelRouteRow struct {
	channel *Channel
	groups  []string
	price   *dto.ChannelPriceSettings
	mapping map[string]string
}

// GetModelChannelRoutes lists every enabled channel that can serve modelName in
// any of the given groups, each with its resolved sell price, ordered cheapest
// first.
//
// The order is the one the price-ranked router would use, so the catalog's
// "candidate order" and the router's actual preference are the same list rather
// than two implementations of the same idea. Rows tie-break on the operator's
// manual priority (higher first) and then channel id, so the output is stable
// across calls — a card list that reshuffles on every poll reads as a bug.
func GetModelChannelRoutes(modelName string, groups []string) []*ChannelRoute {
	if modelName == "" || len(groups) == 0 {
		return nil
	}

	rows := collectChannelRouteRows(modelName, groups)
	routes := make([]*ChannelRoute, 0, len(rows))
	for _, row := range rows {
		routes = append(routes, &ChannelRoute{
			ChannelID: row.channel.Id,
			Name:      row.channel.Name,
			Category:  channelCategoryOf(row.channel.Type),
			LatencyMs: row.channel.ResponseTime,
			Groups:    row.groups,
			Price:     resolveChannelPrice(row.price, modelName, row.mapping),
			priority:  row.channel.GetPriority(),
		})
	}
	for _, route := range routes {
		route.Code = lineCodeOf(modelName, route.Price.UpstreamModel)
	}

	sort.SliceStable(routes, func(i, j int) bool {
		left, right := routes[i], routes[j]
		// Rows with no comparable ratio sink: the list doubles as the router's
		// candidate order, and an unknown price must never be presented as the
		// cheapest option. Per-call rows have a ratio of 0 and land here too,
		// which costs nothing — one call resolves one model name, so every row in
		// this list is per-call or none is, and they fall through to the manual
		// priority the router itself uses for them.
		leftPriced := left.Price.ModelRatio > 0 && !left.Price.PriceUnset
		rightPriced := right.Price.ModelRatio > 0 && !right.Price.PriceUnset
		if leftPriced != rightPriced {
			return leftPriced
		}
		if leftPriced && math.Abs(left.Price.ModelRatio-right.Price.ModelRatio) > priceRankEpsilon {
			return left.Price.ModelRatio < right.Price.ModelRatio
		}
		if left.priority != right.priority {
			return left.priority > right.priority
		}
		return left.ChannelID < right.ChannelID
	})

	return routes
}

func collectChannelRouteRows(modelName string, groups []string) []*channelRouteRow {
	if !common.MemoryCacheEnabled {
		return collectChannelRouteRowsFromDB(modelName, groups)
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	normalizedModel := ratio_setting.FormatMatchingModelName(modelName)
	byChannel := make(map[int]*channelRouteRow)
	ordered := make([]*channelRouteRow, 0)

	for _, group := range groups {
		model2channels, ok := group2model2channels[group]
		if !ok {
			continue
		}
		channelIDs := model2channels[modelName]
		if len(channelIDs) == 0 && normalizedModel != modelName {
			channelIDs = model2channels[normalizedModel]
		}
		for _, channelID := range channelIDs {
			if row, seen := byChannel[channelID]; seen {
				row.groups = append(row.groups, group)
				continue
			}
			channel, ok := channelsIDM[channelID]
			if !ok || channel.Status != common.ChannelStatusEnabled {
				continue
			}
			row := &channelRouteRow{
				channel: channel,
				groups:  []string{group},
				price:   channel2priceSettings[channelID],
				mapping: channel2modelMapping[channelID],
			}
			byChannel[channelID] = row
			ordered = append(ordered, row)
		}
	}
	return ordered
}

// collectChannelRouteRowsFromDB serves installations running with the memory
// cache off. It parses settings per call, which is why the cached path exists;
// the catalog endpoint is not on the relay hot path, so the cost is acceptable
// there.
func collectChannelRouteRowsFromDB(modelName string, groups []string) []*channelRouteRow {
	normalizedModel := ratio_setting.FormatMatchingModelName(modelName)
	modelNames := []string{modelName}
	if normalizedModel != modelName {
		modelNames = append(modelNames, normalizedModel)
	}

	var abilities []Ability
	err := DB.Where(commonGroupCol+" IN ? AND model IN ? AND enabled = ?", groups, modelNames, true).
		Find(&abilities).Error
	if err != nil || len(abilities) == 0 {
		return nil
	}

	groupsByChannel := make(map[int][]string)
	channelIDs := make([]int, 0, len(abilities))
	for _, ability := range abilities {
		if _, seen := groupsByChannel[ability.ChannelId]; !seen {
			channelIDs = append(channelIDs, ability.ChannelId)
		}
		groupsByChannel[ability.ChannelId] = append(groupsByChannel[ability.ChannelId], ability.Group)
	}

	var channels []*Channel
	if err := DB.Where("id IN ? AND status = ?", channelIDs, common.ChannelStatusEnabled).Find(&channels).Error; err != nil {
		return nil
	}

	byID := make(map[int]*Channel, len(channels))
	for _, channel := range channels {
		byID[channel.Id] = channel
	}

	rows := make([]*channelRouteRow, 0, len(channels))
	for _, channelID := range channelIDs {
		channel, ok := byID[channelID]
		if !ok {
			continue
		}
		price, mapping := parseChannelPriceMetadata(channel)
		rows = append(rows, &channelRouteRow{
			channel: channel,
			groups:  groupsByChannel[channelID],
			price:   price,
			mapping: mapping,
		})
	}
	return rows
}
