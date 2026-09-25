package model

import (
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// 卖价的纯算术：进价 × (1 + 利润率)，以及换算成计费内核吃的倍率。
//
// 住在 model 而不是 service，是因为读它的人分布在依赖链两头：结算侧
// （relay/helper、service）和展示/路由侧（本包的 channel_price_cache.go）。
// service 已经 import model，反向不成立，而 relaykit/dto 也放不下——卖价推导要
// 读 ratio_setting 的官方倍率表和 common.QuotaPerUnit，都在根模块，relaykit 必须
// 独立可构建。所以纯计算落在 model，service 那边留类型别名和转发函数。
//
// 两份实现是这里唯一不能接受的结果：广场展示的价和实际扣的钱必须出自同一段
// 算术，否则客户看到一个数、账单是另一个数。

// CostTokenBreakdown 是一笔请求的全部计费 token 明细。
type CostTokenBreakdown struct {
	PromptTokens     int // 文本输入（不含已单列的 cache/image/audio）
	CompletionTokens int
	CacheReadTokens  int
	CacheWrite5m     int
	CacheWrite1h     int
	ImageInput       int
	ImageOutput      int
	AudioInput       int
	AudioOutput      int
	ReasoningTokens  int
}

// maxCostUnitPriceUSD 单价上界（USD per 1M tokens 或 USD/次）。成本单价来自
// JSON 配置，指针可携带任意大的数；超界按配置错误处理，拒绝而不是钳制。
const maxCostUnitPriceUSD = 10000.0

// ValidCostUnitPrice screens one configured unit price. Nil means "not
// configured", which is a legal state the caller resolves further up.
func ValidCostUnitPrice(v *float64) bool {
	if v == nil {
		return false
	}
	if math.IsNaN(*v) || math.IsInf(*v, 0) {
		return false
	}
	return *v >= 0 && *v <= maxCostUnitPriceUSD
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

// maxSellMarkup 利润率上界。100 = 加价 10000%，正常运营到不了，超了就是
// 把百分数当小数填了。
const maxSellMarkup = 100.0

// sellPriceMarkup 取这个模型该用的利润率：ModelCostPrice.Markup 优先，其次
// 渠道级 DefaultMarkup，都没有就 ok=false。
//
// 非法值（NaN/Inf/负数/超界）按"没配"处理并继续往下走，与
// ChannelPriceSettings.ResolveDiscount 同一套态度：一个模型上的笔误不该
// 连带废掉整个渠道的利润率配置。上界跟进价单价的校验对齐，10000 倍加价
// 只能是填错了。
//
// 0 是合法利润率，不是"没配"：运营填 0% 就是要平进平出。
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

// ResolveSellPrice 是渠道-模型的卖价，正推自进价：进价 × (1 + 利润率)。
// 返回 ok=false 表示该渠道-模型没配进价或没配利润率，调用方必须退回老倍率计费
// ——这是渐进上线的开关，填一个生效一个，不额外加 feature flag。
//
// 每条渠道各算各的：同一个模型在四条渠道上有四个进价，就有四个卖价。路由挑最
// 便宜的那条，客户拿到最低价，而每条线各自保住自己的利润率——统一成一个站点价
// 才会出现"最贵的那条一接量就亏"。
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
		if !ValidCostUnitPrice(unit) {
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

// SellPriceRatios 是卖价翻译成本代码库既有计价口径后的倍率组。字段与
// types.PriceData 的倍率字段一一对应，调用方逐项改写即可。
//
// 除 ModelRatio 外全是指针，nil 表示【这个维度推不出倍率，保留平台现有倍率】。
// 不写 1 兜底：1 意味着该维度与 input 同价，而音频/图片/缓存写入普遍更贵，静默
// 按 1 计价是在少收钱。
type SellPriceRatios struct {
	ModelRatio      float64
	CompletionRatio *float64
	CacheRatio      *float64
	// CacheCreationRatio 是未拆分窗口的缓存写入倍率，取 5m 的值：非 Claude 语义
	// 下 CostInputsFromUsage 把 CacheCreationTokensTotal 全部归到 CacheWrite5m，
	// 而 ModelPriceHelper 也拿 5m 当基准窗口（1h 是它乘出来的）。
	CacheCreationRatio   *float64
	CacheCreation5mRatio *float64
	CacheCreation1hRatio *float64
	ImageRatio           *float64
	AudioRatio           *float64
	// AudioCompletionRatio 的分母是【音频输入卖价】，不是 input 卖价。结算侧写的是
	// outputAudioTokens × audioRatio × audioCompletionRatio（service/quota.go），
	// 两个倍率串乘，所以这一项只表达"音频输出比音频输入贵多少"。拿 input 当分母会
	// 让音频输出价偏差一个 audioIn/input 的倍数。
	AudioCompletionRatio *float64
}

// SellPriceToRatios 把卖价换算成计费内核吃的倍率。ok=false 表示这份卖价没法
// 用倍率表达，调用方必须整笔退回老倍率计费。
//
// 换算依据是本代码库唯一的计价恒等式（service/text_quota.go）：各维度 token 数
// 先乘自己的倍率、求和后统一乘 modelRatio × groupRatio。
//
//	quota = Σ(tokens_i × ratio_i) × modelRatio × groupRatio   而 USD = quota ÷ QuotaPerUnit
//
// 所以 input 卖价 P（USD / 1M tokens）对应 modelRatio = P × QuotaPerUnit ÷ 1e6，
// 按当前 QuotaPerUnit=500000 就是 P ÷ 2（倍率 10 ≡ $20/1M）。写成表达式而不是
// 除以 2：QuotaPerUnit 是 var，改了这里要跟着变。
//
// 其余维度在结算侧都是"相对 input 的倍数"，所以取该维度卖价 ÷ input 卖价：代进
// 恒等式后该维度的最终单价恰好等于它自己的卖价，与 modelRatio 怎么分解无关。
// 唯一例外是 AudioCompletionRatio，见该字段的注释。
//
// 没配的维度返回 nil 而不是 1：调用方保留平台倍率。这是刻意的两害相权——平台倍率
// 至少是"上游定价结构的一个估计"（缓存写入 1.25、音频按模型表），而 1 是断言该
// 维度与 input 同价，对音频能差出十几倍。
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

	// ratioAgainst 把一个维度卖价换成"相对某个基准的倍数"。基准可变是为了音频
	// 输出：它的基准是音频输入卖价，不是 input。
	ratioAgainst := func(dim *float64, base float64) *float64 {
		if dim == nil || base <= 0 {
			return nil
		}
		v := *dim / base
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return nil
		}
		return &v
	}
	ratioOf := func(dim *float64) *float64 {
		return ratioAgainst(dim, unit)
	}
	out.CompletionRatio = ratioOf(price.Output)
	out.CacheRatio = ratioOf(price.CacheRead)
	out.CacheCreation5mRatio = ratioOf(price.CacheWrite5m)
	out.CacheCreationRatio = out.CacheCreation5mRatio
	out.CacheCreation1hRatio = ratioOf(price.CacheWrite1h)
	out.ImageRatio = ratioOf(price.ImageIn)
	out.AudioRatio = ratioOf(price.AudioIn)
	// 音频输出没有音频输入进价就推不出倍率：串乘式里它的另一个因子会是平台
	// audioRatio，两套口径相乘得出的单价既不是卖价也不是平台价。模型定价页对同一
	// 条约束的提示是"Audio output price requires an audio input price"。
	out.AudioCompletionRatio = ratioAgainst(price.AudioOut, derefOrZero(price.AudioIn))
	return out, true
}

func derefOrZero(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}
