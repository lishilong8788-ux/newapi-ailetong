package service

import (
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
)

// 上游成本核算。收入（logs.quota）是现成的；本文件补"这笔请求我们付给上游
// 多少钱"。成本与收入同用 quota 单位存储，展示层再折算 USD/CNY。
//
// 成本 key 是 (channel_id, upstream_model_name)——同一个模型走官方直连和走
// 中转商成本可能差一倍，用 origin_model 当成本 key 是错的。
//
// 两级解析链（命中即停）：
//  1. exact    渠道模型精确价 channel_cost.models[upstream_model]
//  2. reported 上游报告真值 usage.Cost（OpenRouter 系响应）
//
// 两级都不命中就是 unknown，不猜。原先还有两级估算——按渠道利润率从收入反推
// 成本，以及官方价 × 渠道折扣——都已删除：前者方向反了（现在利润率是从进价
// 正推卖价用的，反过来用会把「我们卖多少」当成「我们付多少」），后者是估算，
// 而进价现在直接填，没必要再猜一个数出来跟真值混在一张报表里。
//
// 成本绝不乘 groupRatio——分组倍率是售价折扣，不影响上游账单。

// CostSource 标记成本数字的置信度，报表必须按它分层，猜的与准的不混算。
const (
	CostSourceExact    = "exact"    // 渠道模型精确价
	CostSourceReported = "reported" // 上游返回真值
	CostSourceUnknown  = "unknown"  // 无法确定——不参与毛利计算
)

// CostTokenBreakdown 是一笔请求的全部计费 token 明细。定义在 model 一侧，因为
// 卖价的维度覆盖判断（ModelSellPrice.CoversTokens）要用它，而那段算术为了同时
// 服务展示侧和结算侧必须住在 model。
type CostTokenBreakdown = model.CostTokenBreakdown

// CostInputs 是 attachUpstreamCost 的输入快照。
type CostInputs struct {
	Tokens  CostTokenBreakdown
	Usage   *dto.Usage // 原始 usage，取 usage.Cost 真值（可为 nil）
	Revenue int        // 本笔收入（quota）
}

// validCostUnitPrice 与卖价那边共用同一把尺子（model.ValidCostUnitPrice）：
// 同一个进价字段在成本核算里合法、在卖价推导里不合法，是对不上账的。
func validCostUnitPrice(v *float64) bool {
	return model.ValidCostUnitPrice(v)
}

// resolveModelCostExact 第 1 级：渠道模型精确价。
// 返回 USD 金额；ok=false 表示该级不可用（未配置/单价非法/该模型无条目）。
func resolveModelCostExact(cost *dto.ChannelCostSettings, upstreamModel string, t CostTokenBreakdown) (float64, bool) {
	if cost == nil || len(cost.Models) == 0 {
		return 0, false
	}
	price, ok := cost.Models[upstreamModel]
	if !ok {
		return 0, false
	}

	// 按次进价优先：配了 per_call 就是按次买的，不看 token。
	if price.PerCall != nil {
		if !validCostUnitPrice(price.PerCall) {
			return 0, false
		}
		return *price.PerCall, true
	}

	// 按量进价：单价 USD/1M tokens × token 数。配置了任何一个单价字段即视为
	// 命中该级；未配置的字段按 0 计（如只配了 input/output，缓存按 0）。
	var total float64
	anyField := false
	add := func(tokens int, unit *float64) {
		if unit == nil {
			return
		}
		if !validCostUnitPrice(unit) {
			return
		}
		anyField = true
		total += float64(tokens) * *unit / 1e6
	}

	// 输出子类（音频/图片/推理）是 CompletionTokens 的【子集】，不是它的兄弟：
	// Gemini 那边 CompletionTokens = CandidatesTokenCount + ThoughtsTokenCount 而
	// ReasoningTokens = ThoughtsTokenCount（service/billing_usage.go），OpenAI 语义
	// 下 completion_tokens_details 同样是 completion_tokens 的拆分。
	//
	// 所以配了子类单价就必须把它从 CompletionTokens 里扣掉，否则同一批 token 先按
	// output 价算一次、再按子类价算一次。没配单价的子类【留在】CompletionTokens 里
	// 按 output 价计 —— 裸扣会让它按 0 计成本，虚高毛利，正是本文件开头警告的方向。
	billedCompletion := t.CompletionTokens
	subtractIfPriced := func(tokens int, unit *float64) {
		if tokens <= 0 || unit == nil || !validCostUnitPrice(unit) {
			return
		}
		billedCompletion -= tokens
	}
	subtractIfPriced(t.ImageOutput, price.ImageOut)
	subtractIfPriced(t.AudioOutput, price.AudioOut)
	subtractIfPriced(t.ReasoningTokens, price.Reasoning)
	// 上游报的子类之和可以超过 completion 总数（各家统计口径不一），负数会变成
	// 一笔负成本 —— 毛利凭空变高。
	if billedCompletion < 0 {
		billedCompletion = 0
	}

	add(t.PromptTokens, price.Input)
	add(billedCompletion, price.Output)
	add(t.CacheReadTokens, price.CacheRead)
	add(t.CacheWrite5m, price.CacheWrite5m)
	add(t.CacheWrite1h, price.CacheWrite1h)
	add(t.ImageInput, price.ImageIn)
	add(t.ImageOutput, price.ImageOut)
	add(t.AudioInput, price.AudioIn)
	add(t.AudioOutput, price.AudioOut)
	add(t.ReasoningTokens, price.Reasoning)
	if !anyField {
		return 0, false
	}
	return total, true
}

// upstreamReportedCostUSD 解析 usage.Cost。OpenRouter 系响应里它可能是
// number 也可能是 object（{total: x}），与 CalcOpenRouterCacheCreateTokens
// 保持同一套兜底，否则同一响应被解析两次、口径不一致。
func upstreamReportedCostUSD(usage *dto.Usage) (float64, bool) {
	if usage == nil || usage.Cost == nil {
		return 0, false
	}
	switch v := usage.Cost.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return 0, false
		}
		return v, true
	case int:
		if v < 0 {
			return 0, false
		}
		return float64(v), true
	case int64:
		if v < 0 {
			return 0, false
		}
		return float64(v), true
	case map[string]interface{}:
		// OpenRouter 偶发 {total: ...} 形态
		for _, key := range []string{"total", "cost"} {
			if raw, ok := v[key]; ok {
				if f, ok := raw.(float64); ok && !math.IsNaN(f) && !math.IsInf(f, 0) && f >= 0 {
					return f, true
				}
			}
		}
		return 0, false
	default:
		return 0, false
	}
}

// ComputeUpstreamCost 走完两级链，返回 (成本quota, source)。
// 求值失败一律 (0, unknown)——记 0 成本会让毛利虚高到 100%，是最危险的
// 静默错误；unknown 单独统计"未定价流量占比"，不参与毛利计算。
//
// 没配进价就是 unknown：不再拿收入反推、也不再按官方价估。成本要么是填进去
// 的真进价、要么是上游回报的真值，别的都不算成本。
func ComputeUpstreamCost(cost *dto.ChannelCostSettings, upstreamModel string, inputs CostInputs) (int, string) {
	if usd, ok := resolveModelCostExact(cost, upstreamModel, inputs.Tokens); ok {
		return costUSDToQuota(usd), CostSourceExact
	}
	if usd, ok := upstreamReportedCostUSD(inputs.Usage); ok && usd > 0 {
		return costUSDToQuota(usd), CostSourceReported
	}
	return 0, CostSourceUnknown
}

// costUSDToQuota 把 USD 成本换算为 quota，饱和转换走 quota_math。
func costUSDToQuota(usd float64) int {
	if usd <= 0 {
		return 0
	}
	quota, clamp := common.QuotaFromFloatChecked(usd * common.QuotaPerUnit)
	if clamp != nil {
		common.SysError(fmt.Sprintf("cost quota saturation: original=%g clamped=%d", clamp.Original, clamp.Clamped))
	}
	if quota < 0 {
		// 成本不得为负：负成本 = 毛利虚高 = 自动处置误判。
		common.SysError(fmt.Sprintf("negative upstream cost clamped to 0: %d", quota))
		return 0
	}
	return quota
}

// attachUpstreamCostForChannel 给拿不到 relayInfo 的结算点写成本快照：任务差额
// 结算跑在 context.Context 上，渠道只能按 id 查。
//
// 与 attachUpstreamCost 的关键区别是【不调 RecordCostSample】。任务在提交时已
// 按预扣额采过一次样，差额结算再采一次会把同一笔收入重复累加进 channel_cost_daily。
// 所以这里只负责日志可见性，日聚合表里任务的成本仍是提交时的估算——那个偏差要
// 修得先定清楚是记增量还是覆盖，属于改既有聚合语义，不在快照的职责里。
func attachUpstreamCostForChannel(channelId int, upstreamModel string, revenue int, other map[string]interface{}) {
	if other == nil {
		return
	}
	channel, err := model.CacheGetChannel(channelId)
	if err != nil || channel == nil {
		return
	}
	costSettings := channel.GetOtherSettings().Cost
	costQuota, source := ComputeUpstreamCost(costSettings, upstreamModel, CostInputs{Revenue: revenue})

	adminInfo, ok := other["admin_info"].(map[string]interface{})
	if !ok || adminInfo == nil {
		adminInfo = map[string]interface{}{}
		other["admin_info"] = adminInfo
	}
	adminInfo["cost"] = map[string]interface{}{
		"cost_quota":   costQuota,
		"cost_source":  source,
		"cost_model":   upstreamModel,
		"margin_quota": revenue - costQuota,
		// 这份成本的口径不是本行的流水：revenue 是任务的最终总额，而这条日志的
		// quota 字段只是差额（或退款额）。所以 cost 与 quota 不同尺度，不能相减、
		// 也不能跨行相加——提交时已经按完整成本记过一行了，这里再算一份完整成本，
		// 两行加起来是双倍。
		//
		// 明确标出来而不是让下游猜：交易账本要把成本落成可排序的真列，而"能不能
		// 落列"取决于这份成本是否与本行收入同尺度。没有这个标记，账本会把任务的
		// 成本算两遍，毛利率直接翻负。
		"row_scoped": false,
	}
}

// attachUpstreamCost 在各计费路径 RecordConsumeLog 前一行调用，把成本快照
// 嵌进 other.admin_info.cost（自动获得管理员可见性——非管理员视图剥离整个
// admin_info）。与 attachQuotaSaturation 同构，是本代码库的既定习惯。
func attachUpstreamCost(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, inputs CostInputs, other map[string]interface{}) {
	if other == nil {
		return
	}
	if relayInfo == nil || relayInfo.ChannelMeta == nil {
		return
	}

	var cost *dto.ChannelCostSettings
	if relayInfo.ChannelMeta != nil {
		cost = relayInfo.ChannelMeta.ChannelOtherSettings.Cost
	}
	upstreamModel := relayInfo.GetUpstreamModelName()
	if upstreamModel == "" {
		upstreamModel = relayInfo.OriginModelName
	}

	costQuota, source := ComputeUpstreamCost(cost, upstreamModel, inputs)

	// 同步进内存桶（定时 flush 到 channel_cost_daily）。
	//
	// 运营流量不采样：渠道测试、playground、运营副驾花的是真上游成本、收的是自己的
	// 钱，进毛利统计就是报一笔不存在的账。重算路径（parseLogForCostRecalc）早就按
	// model.OpsTrafficSources 排除了，实时路径必须同口径——否则每次重算后这部分消失、
	// 实时运行又攒回来，两个口径永远对不上。
	//
	// 副驾尤其要挡：它问自己的模型时烧的 token 会落进它自己要报的那份毛利的分母，
	// 而且多数是未定价的，直接顶高"未定价流量占比"这个健康度指标。
	//
	// 只挡采样，成本快照照写：账本要按行显示每一笔的成本，运营流量那几行也要能看。
	if relayInfo.ChannelId > 0 && !model.IsOpsTrafficSource(trafficSourceOf(ctx)) {
		reported := int64(0)
		if reportedUSD, ok := upstreamReportedCostUSD(inputs.Usage); ok && reportedUSD > 0 {
			reported = int64(costUSDToQuota(reportedUSD))
		}
		RecordCostSample(relayInfo.ChannelId, upstreamModel, inputs.Revenue, costQuota,
			source == CostSourceUnknown, reported,
			int64(inputs.Tokens.PromptTokens+inputs.Tokens.CompletionTokens+
				inputs.Tokens.CacheReadTokens+inputs.Tokens.CacheWrite5m+inputs.Tokens.CacheWrite1h+
				inputs.Tokens.ImageInput+inputs.Tokens.ImageOutput+inputs.Tokens.AudioInput+inputs.Tokens.AudioOutput))
	}

	adminInfo, ok := other["admin_info"].(map[string]interface{})
	if !ok || adminInfo == nil {
		adminInfo = map[string]interface{}{}
		other["admin_info"] = adminInfo
	}
	costInfo := map[string]interface{}{
		"cost_quota":  costQuota,
		"cost_source": source,
		"cost_model":  upstreamModel,
	}
	if reportedUSD, ok := upstreamReportedCostUSD(inputs.Usage); ok && reportedUSD > 0 {
		costInfo["cost_reported"] = costUSDToQuota(reportedUSD)
	}
	margin := inputs.Revenue - costQuota
	costInfo["margin_quota"] = margin
	adminInfo["cost"] = costInfo

	if source == CostSourceUnknown {
		logger.LogDebug(ctx, fmt.Sprintf("upstream cost unknown: channel=%d model=%s upstream_model=%s",
			relayInfo.ChannelId, relayInfo.OriginModelName, upstreamModel))
	}
}

// CostInputsFromUsage 从 dto.Usage 提取成本核算需要的 token 明细。
// 文本/音频路通用；P/C 语义与 BuildTieredTokenParams 一致：Claude 语义下
// prompt/completion 已是纯文本，OpenAI 语义下是含子类的总数——成本侧因按
// 子类单价分别计价，需要把子类从总数里剥出来，未单列子类按 input 价算。
func CostInputsFromUsage(usage *dto.Usage, revenue int) CostInputs {
	inputs := CostInputs{Revenue: revenue}
	if usage == nil {
		return inputs
	}
	inputs.Usage = usage
	t := &inputs.Tokens
	t.CacheReadTokens = usage.PromptTokensDetails.CachedTokens
	t.CacheWrite5m = usage.PromptTokensDetails.CacheCreationTokensTotal()
	if usage.UsageSemantic == "anthropic" {
		t.CacheWrite5m = usage.ClaudeCacheCreation5mTokens
		t.CacheWrite1h = usage.ClaudeCacheCreation1hTokens
	}
	t.ImageInput = usage.PromptTokensDetails.ImageTokens
	t.AudioInput = usage.PromptTokensDetails.AudioTokens
	t.ImageOutput = usage.CompletionTokenDetails.ImageTokens
	t.AudioOutput = usage.CompletionTokenDetails.AudioTokens
	t.ReasoningTokens = usage.CompletionTokenDetails.ReasoningTokens

	prompt := usage.PromptTokens
	completion := usage.CompletionTokens
	// OpenAI 语义：prompt/completion 是含 cache/image/audio 的总数，剥掉
	// 已单列的子类，避免双算（与 BuildTieredTokenParams 的归一化一致）。
	if usage.UsageSemantic != "anthropic" {
		prompt -= t.CacheReadTokens + t.CacheWrite5m + t.ImageInput + t.AudioInput
		if prompt < 0 {
			prompt = 0
		}
	}
	t.PromptTokens = prompt
	t.CompletionTokens = completion
	return inputs
}

// CostInputsFromRealtimeUsage 从 RealtimeUsage（WSS 路）提取成本 token 明细。
func CostInputsFromRealtimeUsage(usage *dto.RealtimeUsage, revenue int) CostInputs {
	inputs := CostInputs{Revenue: revenue}
	if usage == nil {
		return inputs
	}
	t := &inputs.Tokens
	t.CacheReadTokens = usage.InputTokenDetails.CachedTokens
	t.ImageInput = usage.InputTokenDetails.ImageTokens
	t.AudioInput = usage.InputTokenDetails.AudioTokens
	t.ImageOutput = usage.OutputTokenDetails.ImageTokens
	t.AudioOutput = usage.OutputTokenDetails.AudioTokens
	t.ReasoningTokens = usage.OutputTokenDetails.ReasoningTokens
	// Realtime 的 input_tokens 是含音频/缓存的总数，剥掉子类避免双算。
	prompt := usage.InputTokens - t.CacheReadTokens - t.ImageInput - t.AudioInput
	if prompt < 0 {
		prompt = 0
	}
	t.PromptTokens = prompt
	t.CompletionTokens = usage.OutputTokens
	return inputs
}

// trafficSourceOf 统一读取请求来源标记，供毛利统计过滤。
// 唯一调用方是 attachUpstreamCost 的采样闸门；写日志那一份在
// service/log_info_generate.go 里直接读 context key。
func trafficSourceOf(ctx *gin.Context) string {
	if ctx == nil {
		return ""
	}
	return common.GetContextKeyString(ctx, constant.ContextKeyTrafficSource)
}
