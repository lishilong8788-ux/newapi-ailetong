package service

import (
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/shopspring/decimal"

	"github.com/gin-gonic/gin"
)

// PriceSource marks which rung of the discount chain produced a sell price.
// Reports must stratify on it: traffic still on the legacy ratio path and
// traffic repriced off the vendor list price are not the same number, and
// averaging them hides exactly the misconfiguration an operator needs to see.
const (
	PriceSourceExact    = "exact"    // 渠道 + 模型精确折扣
	PriceSourceChannel  = "channel"  // 渠道级统一折扣
	PriceSourceFallback = "fallback" // 未配折扣或官网价缺失 —— 走 modelRatio × group_ratio
)

// Discount bounds. A discount of 0 is not "free by configuration", it is an
// operator who typed into the wrong box: every token of every model on that
// channel would ship at no charge. Reject it outright rather than honour it —
// the legitimate way to give a model away is a free-model price rule, which
// already exists and is visible in the catalog.
//
// The upper bound is 1.0 because the baseline is the vendor list price and
// selling above list has no product meaning here; an operator who wants that
// is describing a markup, which belongs on the cost side.
const (
	minSellDiscount = 0.001 // 0.01折，实质是防手滑的下限而非业务下限
	maxSellDiscount = 1.0   // 10折 = 官网原价
)

// validSellDiscount screens a configured discount. Pointer-nil means "not
// configured" and is a legal state — the caller falls through to the next rung
// — so it is not an error here, just a miss.
func validSellDiscount(d *float64) bool {
	if d == nil {
		return false
	}
	v := *d
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return false
	}
	return v >= minSellDiscount && v <= maxSellDiscount
}

// ResolveSellDiscount walks the discount chain for one upstream model and
// returns the fraction of the vendor list price to charge.
//
// The contract is deliberately the OPPOSITE of ComputeUpstreamCost's: cost
// resolution answers (0, unknown) when it cannot price something, because
// booking zero cost inflates margin to 100% and that is the dangerous silent
// failure on the expense side. Here a zero would mean giving the request away,
// so an unresolvable price reports ok=false and the caller must keep the
// existing modelRatio × group_ratio result untouched. Never substitute a
// number of our own invention into a customer's bill.
func ResolveSellDiscount(price *dto.ChannelPriceSettings, upstreamModel string) (float64, string, bool) {
	if price == nil {
		return 0, PriceSourceFallback, false
	}

	if len(price.Models) > 0 {
		if d, ok := price.Models[upstreamModel]; ok && validSellDiscount(d) {
			return *d, PriceSourceExact, true
		}
	}

	if validSellDiscount(price.Discount) {
		return *price.Discount, PriceSourceChannel, true
	}

	return 0, PriceSourceFallback, false
}

// ComputeListPriceQuota prices a request at the vendor's list rates, in quota
// units. Returned complete=false means some token kind on this request has no
// official rate and the figure is a LOWER BOUND — margin computed against it
// would be overstated, so callers must exclude those rows rather than treat the
// gap as zero.
//
// All three official coefficients move together on purpose. completion_ratio
// and cache_ratio are multipliers applied to token counts before the whole sum
// is scaled by model_ratio (service/text_quota.go:355-357), not standalone unit
// prices. Swapping only model_ratio for its official counterpart while keeping
// the platform's completion_ratio would make the realized discount on output
// tokens discount × (platformCompletion / officialCompletion) — off-target by
// the ratio between the two, and worst on reasoning models where output
// dominates. The advertised discount would not be the discount charged.
//
// group_ratio is deliberately absent: the discount is defined against the
// vendor list price, so a group multiplier on top would mean a channel
// advertising 4.4折 bills a vip group 3.52折.
func ComputeListPriceQuota(upstreamModel string, t CostTokenBreakdown) (int, bool) {
	modelRatio, ok := ratio_setting.GetOfficialModelRatio(upstreamModel)
	if !ok || modelRatio <= 0 || math.IsNaN(modelRatio) || math.IsInf(modelRatio, 0) {
		return 0, false
	}

	// Only model/completion/cache have official tables. Image, audio and
	// cache-write tokens are unpriceable at list rates, so their presence caps
	// what this function can honestly claim.
	complete := t.ImageInput == 0 && t.ImageOutput == 0 &&
		t.AudioInput == 0 && t.AudioOutput == 0 &&
		t.CacheWrite5m == 0 && t.CacheWrite1h == 0

	completionRatio, hasCompletion := ratio_setting.GetOfficialCompletionRatio(upstreamModel)
	if !hasCompletion || completionRatio < 0 || math.IsNaN(completionRatio) || math.IsInf(completionRatio, 0) {
		if t.CompletionTokens > 0 {
			return 0, false
		}
		completionRatio = 0
	}

	billed := decimal.NewFromInt(int64(t.PromptTokens))
	if t.CacheReadTokens > 0 {
		cacheRatio, hasCache := ratio_setting.GetOfficialCacheRatio(upstreamModel)
		if !hasCache || cacheRatio < 0 || math.IsNaN(cacheRatio) || math.IsInf(cacheRatio, 0) {
			return 0, false
		}
		billed = billed.Add(decimal.NewFromInt(int64(t.CacheReadTokens)).Mul(decimal.NewFromFloat(cacheRatio)))
	}
	billed = billed.Add(decimal.NewFromInt(int64(t.CompletionTokens)).Mul(decimal.NewFromFloat(completionRatio)))

	listQuota, clamp := common.QuotaFromDecimalChecked(billed.Mul(decimal.NewFromFloat(modelRatio)))
	if clamp != nil {
		common.SysError(fmt.Sprintf("list price quota saturation: model=%s original=%g clamped=%d",
			upstreamModel, clamp.Original, clamp.Clamped))
	}
	if listQuota < 0 {
		return 0, false
	}
	return listQuota, complete
}

// attachSellPrice records which discount governed a request next to the cost
// snapshot attachUpstreamCost writes, so one log line carries both sides of the
// margin.
//
// It runs AFTER SettleBilling on every path that calls it, so nothing here can
// change what the customer paid — charged is reported as observed, not derived.
// That is deliberate for the first cut: the discount becomes visible and
// auditable before it is allowed to move money. Repricing has to happen before
// settlement, which is a different set of call sites entirely.
func attachSellPrice(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, charged int, tokens CostTokenBreakdown, other map[string]interface{}) {
	if other == nil {
		return
	}
	if relayInfo == nil || relayInfo.ChannelMeta == nil {
		return
	}

	price := relayInfo.ChannelMeta.ChannelOtherSettings.Price
	upstreamModel := relayInfo.GetUpstreamModelName()
	if upstreamModel == "" {
		upstreamModel = relayInfo.OriginModelName
	}

	writeSellPriceSnapshot(price, upstreamModel, charged, tokens, other)
}

// attachSellPriceForChannel is the relayInfo-less path: async task settlement
// runs on a plain context.Context long after the relay finished, so the channel
// has to be looked up by id. Kept separate from attachSellPrice rather than
// folded into it — the request paths already hold the settings in memory and
// must not pay a cache lookup (or a DB read, when the memory cache is off) for
// a snapshot.
func attachSellPriceForChannel(channelId int, upstreamModel string, charged int, tokens CostTokenBreakdown, other map[string]interface{}) {
	if other == nil {
		return
	}
	channel, err := model.CacheGetChannel(channelId)
	if err != nil || channel == nil {
		// A deleted channel is normal here: settlement can land after the
		// operator removed it. Record nothing rather than guess a discount.
		return
	}
	writeSellPriceSnapshot(channel.GetOtherSettings().Price, upstreamModel, charged, tokens, other)
}

func writeSellPriceSnapshot(price *dto.ChannelPriceSettings, upstreamModel string, charged int, tokens CostTokenBreakdown, other map[string]interface{}) {
	// Guarded here as well as in the callers: assigning into a nil map panics,
	// and a billing path must not crash over a snapshot it only writes for
	// reporting.
	if other == nil {
		return
	}

	discount, source, ok := ResolveSellDiscount(price, upstreamModel)

	adminInfo, exists := other["admin_info"].(map[string]interface{})
	if !exists || adminInfo == nil {
		adminInfo = map[string]interface{}{}
		other["admin_info"] = adminInfo
	}
	priceInfo := map[string]interface{}{
		"price_source":  source,
		"price_model":   upstreamModel,
		"charged_quota": charged,
	}
	if ok {
		priceInfo["discount"] = discount
	}

	// 应收 = 官网价 × 折扣。只在折扣确实生效时算：fallback 的那笔走的是老计费
	// 路径，给它配一个"本该收多少"会让报表以为折扣已经在生效。
	if listQuota, complete := ComputeListPriceQuota(upstreamModel, tokens); listQuota > 0 {
		priceInfo["list_quota"] = listQuota
		priceInfo["list_complete"] = complete
		if ok {
			expected, clamp := common.QuotaFromFloatChecked(float64(listQuota) * discount)
			if clamp == nil && expected >= 0 {
				priceInfo["expected_quota"] = expected
			}
		}
	}
	adminInfo["price"] = priceInfo
}
