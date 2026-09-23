package service

import (
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
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
//
// The values live on dto.ChannelPriceSettings so model/ can rank channels by
// price without importing service (which imports model). These aliases keep the
// existing call sites and tests reading off one vocabulary.
const (
	PriceSourceExact    = dto.PriceSourceExact    // 渠道 + 模型精确折扣
	PriceSourceChannel  = dto.PriceSourceChannel  // 渠道级统一折扣
	PriceSourceFallback = dto.PriceSourceFallback // 未配折扣或官网价缺失 —— 走 modelRatio × group_ratio
)

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
	return price.ResolveDiscount(upstreamModel)
}

// ModelSellPrice 是一个渠道-模型的卖价，各维度单价 USD / 1M tokens，与
// dto.ModelCostPrice 同单位同维度，方便一眼对上"进价多少、卖多少"。
//
// 指针沿用进价那边的理由，但这里多一层含义：nil 表示这个维度【推不出卖价】，
// 调用方遇到该维度有 token 就必须整笔退回老倍率计费——记 0 等于把这部分
// token 免费送。0 本身仍是合法卖价（免费模型进价 0，加价后还是 0）。
type ModelSellPrice struct {
	Input        *float64
	Output       *float64
	CacheRead    *float64
	CacheWrite5m *float64
	CacheWrite1h *float64
	AudioIn      *float64
	AudioOut     *float64
	ImageIn      *float64
	ImageOut     *float64
	Reasoning    *float64
	PerCall      *float64 // USD / 次，进价按次时才有
	// Markup 是这笔卖价用的利润率，报表要能回答"这个价是按多少利润率算的"。
	Markup float64
}

// CoversTokens 报告这份卖价能否完整覆盖一次请求用到的 token 维度。
// false 意味着有维度推不出价（nil），调用方必须整笔退回老倍率计费而不是
// 把缺的维度当 0 —— 那等于白送。按次计价（PerCall）不看 token 维度。
func (p ModelSellPrice) CoversTokens(t CostTokenBreakdown) bool {
	if p.PerCall != nil {
		return true
	}
	covered := func(tokens int, unit *float64) bool {
		return tokens == 0 || unit != nil
	}
	return covered(t.PromptTokens, p.Input) &&
		covered(t.CompletionTokens, p.Output) &&
		covered(t.CacheReadTokens, p.CacheRead) &&
		covered(t.CacheWrite5m, p.CacheWrite5m) &&
		covered(t.CacheWrite1h, p.CacheWrite1h) &&
		covered(t.AudioInput, p.AudioIn) &&
		covered(t.AudioOutput, p.AudioOut) &&
		covered(t.ImageInput, p.ImageIn) &&
		covered(t.ImageOutput, p.ImageOut) &&
		covered(t.ReasoningTokens, p.Reasoning)
}

// sellPriceMarkup 取这个模型该用的利润率：ModelCostPrice.Markup 优先，其次
// 渠道级 DefaultMarkup，都没有就 ok=false。
//
// 非法值（NaN/Inf/负数/超界）按"没配"处理并继续往下走，与
// ChannelPriceSettings.ResolveDiscount 同一套态度：一个模型上的笔误不该
// 连带废掉整个渠道的利润率配置。上界跟进价单价的校验对齐，10000 倍加价
// 只能是填错了。
func sellPriceMarkup(cost *dto.ChannelCostSettings, price dto.ModelCostPrice) (float64, bool) {
	valid := func(v *float64) bool {
		if v == nil {
			return false
		}
		return !math.IsNaN(*v) && !math.IsInf(*v, 0) && *v >= 0 && *v <= maxSellMarkup
	}
	if valid(price.Markup) {
		return *price.Markup, true
	}
	if cost != nil && valid(cost.DefaultMarkup) {
		return *cost.DefaultMarkup, true
	}
	return 0, false
}

// maxSellMarkup 利润率上界。100 = 加价 10000%，正常运营到不了，超了就是
// 把百分数当小数填了。
const maxSellMarkup = 100.0

// ResolveSellPrice 是渠道-模型的卖价，正推自进价：进价 × (1 + 利润率)。
// 返回 ok=false 表示该渠道-模型没配进价或没配利润率，调用方必须退回老倍率计费
// ——这是渐进上线的开关，填一个生效一个，不额外加 feature flag。
//
// 进价缺某个维度时按官方倍率从 input 进价推导，这是"一个数管全维度"的关键：
// 运营只填 input（有时连 output 都不填），剩下的维度用 ratio_setting 里的官方
// 倍率折出来——官方 completionRatio 给 output，官方 cacheRatio 给 cache read。
// 官方倍率表本身就是"相对 input 的倍数"（service/text_quota.go 的计价口径），
// 所以 input 进价 × 官方倍率就是该维度的进价。
//
// 只认官方倍率表，不拿平台自己的倍率兜底：平台倍率是我们的售价口径，用它推进价
// 等于用卖价猜成本，绕回刚删掉的那条反推链。官方表只覆盖 model/completion/cache
// 三项（同 ComputeListPriceQuota），所以 cache write、音频、图片、reasoning 这几个
// 维度没填就是 nil —— 让调用方整笔退回老计费，而不是当 0 白送。
func ResolveSellPrice(cost *dto.ChannelCostSettings, upstreamModel string) (ModelSellPrice, bool) {
	if cost == nil || len(cost.Models) == 0 {
		return ModelSellPrice{}, false
	}
	costPrice, ok := cost.Models[upstreamModel]
	if !ok {
		return ModelSellPrice{}, false
	}
	markup, ok := sellPriceMarkup(cost, costPrice)
	if !ok {
		return ModelSellPrice{}, false
	}

	multiplier := 1 + markup
	// sell 把一个进价维度转成卖价维度。进价非法（NaN/Inf/负/超界）按未配置
	// 处理，返回 nil 让调用方退回老计费——不是钳到边界值继续算。
	sell := func(unit *float64) *float64 {
		if !validCostUnitPrice(unit) {
			return nil
		}
		v := *unit * multiplier
		return &v
	}

	out := ModelSellPrice{Markup: markup, PerCall: sell(costPrice.PerCall)}
	// 按次进价与按量进价互斥（resolveModelCostExact 也是 per_call 优先），
	// 按次时 token 维度一律不填，免得两套口径同时命中。
	if out.PerCall != nil {
		return out, true
	}

	out.Input = sell(costPrice.Input)
	out.Output = sell(costPrice.Output)
	out.CacheRead = sell(costPrice.CacheRead)
	out.CacheWrite5m = sell(costPrice.CacheWrite5m)
	out.CacheWrite1h = sell(costPrice.CacheWrite1h)
	out.AudioIn = sell(costPrice.AudioIn)
	out.AudioOut = sell(costPrice.AudioOut)
	out.ImageIn = sell(costPrice.ImageIn)
	out.ImageOut = sell(costPrice.ImageOut)
	out.Reasoning = sell(costPrice.Reasoning)

	if out.Input == nil {
		// 没有 input 进价就没有推导基准，只有显式填过的维度算数；一个维度都
		// 没有的话这条配置等于空的。
		if out.Output == nil && out.CacheRead == nil && out.CacheWrite5m == nil &&
			out.CacheWrite1h == nil && out.AudioIn == nil && out.AudioOut == nil &&
			out.ImageIn == nil && out.ImageOut == nil && out.Reasoning == nil {
			return ModelSellPrice{}, false
		}
		return out, true
	}

	if out.Output == nil {
		if completionRatio, has := ratio_setting.GetOfficialCompletionRatio(upstreamModel); has &&
			completionRatio >= 0 && !math.IsNaN(completionRatio) && !math.IsInf(completionRatio, 0) {
			derived := *out.Input * completionRatio
			out.Output = &derived
		}
	}
	if out.CacheRead == nil {
		if cacheRatio, has := ratio_setting.GetOfficialCacheRatio(upstreamModel); has &&
			cacheRatio >= 0 && !math.IsNaN(cacheRatio) && !math.IsInf(cacheRatio, 0) {
			derived := *out.Input * cacheRatio
			out.CacheRead = &derived
		}
	}
	return out, true
}

// SellPriceRatios 是卖价翻译成本代码库既有计价口径后的倍率三元组。
//
// CompletionRatio/CacheRatio 是指针，nil 表示【这个维度推不出倍率，保留平台
// 现有倍率】。不写 1 兜底：1 意味着 output 与 input 同价，而绝大多数模型 output
// 更贵，静默按 1 计价是在少收钱。
type SellPriceRatios struct {
	ModelRatio      float64
	CompletionRatio *float64
	CacheRatio      *float64
}

// SellPriceToRatios 把卖价换算成计费内核吃的倍率。ok=false 表示这份卖价没法
// 用倍率表达，调用方必须整笔退回老倍率计费。
//
// 换算依据是本代码库唯一的计价恒等式（service/text_quota.go）：
//
//	quota = tokens × modelRatio × groupRatio      而 USD = quota ÷ QuotaPerUnit
//
// 所以 input 卖价 P（USD / 1M tokens）对应 modelRatio = P × QuotaPerUnit ÷ 1e6，
// 按当前 QuotaPerUnit=500000 就是 P ÷ 2（倍率 10 ≡ $20/1M）。写成表达式而不是
// 除以 2：QuotaPerUnit 是 var，改了这里要跟着变。
//
// 其余维度在结算侧都是"相对 input 的倍数"，所以直接取比值。
func SellPriceToRatios(price ModelSellPrice) (SellPriceRatios, bool) {
	// 按次卖价没有 per-token 基准，倍率体系表达不了，交给调用方走原路。
	if price.PerCall != nil {
		return SellPriceRatios{}, false
	}
	// 没有 input 卖价就没有换算起点：modelRatio 是所有维度的公共因子。
	if price.Input == nil {
		return SellPriceRatios{}, false
	}
	unit := *price.Input
	if math.IsNaN(unit) || math.IsInf(unit, 0) || unit < 0 {
		return SellPriceRatios{}, false
	}

	out := SellPriceRatios{ModelRatio: unit * common.QuotaPerUnit / 1e6}

	if unit == 0 {
		// 免费进价：modelRatio=0 会把整笔请求算成免费，包括 output。只有
		// output 也免费时这才是对的；否则倍率体系压根表达不了"输入免费、
		// 输出收费"，宁可退回老计费也不能白送 output。
		if price.Output != nil && *price.Output != 0 {
			return SellPriceRatios{}, false
		}
		return out, true
	}

	ratioOf := func(dim *float64) *float64 {
		if dim == nil {
			return nil
		}
		v := *dim / unit
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return nil
		}
		return &v
	}
	out.CompletionRatio = ratioOf(price.Output)
	out.CacheRatio = ratioOf(price.CacheRead)
	return out, true
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

	upstreamModel := relayInfo.GetUpstreamModelName()
	if upstreamModel == "" {
		upstreamModel = relayInfo.OriginModelName
	}

	writeSellPriceSnapshot(relayInfo.ChannelMeta.ChannelOtherSettings, upstreamModel, sellPriceChannel{
		Id: relayInfo.GetChannelID(),
		// 从 context 读而不是回查渠道：这条路径刻意不做缓存查询（见
		// attachSellPriceForChannel 的注释），分发时已经把它放好了。
		LineCode: common.GetContextKeyString(ctx, constant.ContextKeyServingLineCode),
	}, charged, tokens, other)
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
	writeSellPriceSnapshot(channel.GetOtherSettings(), upstreamModel, sellPriceChannel{
		Id:       channel.Id,
		LineCode: channel.GetLineCode(),
	}, charged, tokens, other)
}

// sellPriceChannel 是快照里"谁服务了这笔请求"的那一半。毛利报表要按线路归集，
// 所以线路码和渠道 id 一起记：渠道 id 会被运营删掉重建，线路码是对外的稳定标识。
type sellPriceChannel struct {
	Id       int
	LineCode string
}

func writeSellPriceSnapshot(settings dto.ChannelOtherSettings, upstreamModel string, channel sellPriceChannel, charged int, tokens CostTokenBreakdown, other map[string]interface{}) {
	// Guarded here as well as in the callers: assigning into a nil map panics,
	// and a billing path must not crash over a snapshot it only writes for
	// reporting.
	if other == nil {
		return
	}

	discount, source, ok := ResolveSellDiscount(settings.Price, upstreamModel)

	adminInfo, exists := other["admin_info"].(map[string]interface{})
	if !exists || adminInfo == nil {
		adminInfo = map[string]interface{}{}
		other["admin_info"] = adminInfo
	}
	priceInfo := map[string]interface{}{
		"price_source":  source,
		"price_model":   upstreamModel,
		"charged_quota": charged,
		// 服务渠道的身份。毛利报表的第三元：没有它，一行日志只能回答"卖了多少、
		// 成本多少"，答不上来"这笔毛利是哪条线做出来的"。
		"channel_id": channel.Id,
	}
	if channel.LineCode != "" {
		priceInfo["line_code"] = channel.LineCode
	}
	if ok {
		priceInfo["discount"] = discount
	}

	// 卖价口径：这笔请求的价是不是由"进价 × (1 + 利润率)"定的。记利润率和 input
	// 卖价单价，报表才能把 charged_quota 拆回"进价多少、加了多少"，而不是只看到
	// 一个合计数。与 discount 并存是故意的：两套口径在灰度期同时存在，报表要能
	// 分层，混成一个字段就分不开了。
	if sell, sellOK := ResolveSellPrice(settings.Cost, upstreamModel); sellOK {
		priceInfo["sell_markup"] = sell.Markup
		if sell.Input != nil {
			priceInfo["sell_input_price"] = *sell.Input
		}
		if sell.PerCall != nil {
			priceInfo["sell_per_call_price"] = *sell.PerCall
		}
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
