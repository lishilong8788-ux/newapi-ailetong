package copilot

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// 两个纯计算工具。它们一行都不写库、不动缓存，但算出来的数会被拿去定价，所以
// 算术本身必须是【生产那一段】：卖价一律经 model.ResolveSellPrice +
// model.SellPriceToRatios 得出，绝不在这里自己乘一遍。
//
// 自己乘的风险不是笔误，是口径分叉：ResolveSellPrice 还负责"缺失维度按官方倍率
// 从 input 推导""按次价与按量价互斥""非法进价按未配置处理"这几条规则，任何一条
// 在副驾这边省掉，模拟出的卖价就和真实计费不是一个数——而运营会照着模拟值去配。

// maxSimulateMarkup 与 model 层 sellPriceMarkup 的上界一致：100 = 加价 10000%，
// 正常运营到不了，超了就是把百分数当小数填了（填 30 而不是 0.3）。
const maxSimulateMarkup = 100.0

// validateSimulateMarkup 校验调用方给的利润率。
//
// 0 必须放行：运营填 0% 就是要平进平出，而"0 当成没配"正是 7.1 那个 bug 的形状
// （前端 markup > 0 的判据让 default_markup 不进 JSON，整条卖价链静默退回老计费）。
func validateSimulateMarkup(markup float64) error {
	if math.IsNaN(markup) || math.IsInf(markup, 0) {
		return fmt.Errorf("markup 必须是有限数字")
	}
	if markup < 0 || markup > maxSimulateMarkup {
		return fmt.Errorf("markup 必须在 0~%g 之间（0.3 = 加价 30%%），收到 %g", maxSimulateMarkup, markup)
	}
	return nil
}

// costSettingsWithMarkup 复制一份成本配置，把目标模型的利润率换成 markup。
//
// 必须复制：入参那份来自渠道缓存/数据库行，就地改会把一次"模拟"变成对线上定价的
// 静默修改。写的是【模型级】Markup 而不是 DefaultMarkup，因为模型级优先
// （model.sellPriceMarkup 的顺序），只改渠道级的话已配模型覆盖的那一条会照旧用
// 自己的值，调用方给的数就被无声吞掉。
func costSettingsWithMarkup(cost *dto.ChannelCostSettings, upstreamModel string, markup float64) *dto.ChannelCostSettings {
	if cost == nil {
		return nil
	}
	clone := *cost
	clone.Models = make(map[string]dto.ModelCostPrice, len(cost.Models))
	for name, price := range cost.Models {
		clone.Models[name] = price
	}
	price, ok := clone.Models[upstreamModel]
	if !ok {
		// 没有这个模型的进价条目就不造一个：没有进价就推不出卖价，这是
		// ResolveSellPrice 该报的 false，不是这里该补的默认值。
		return &clone
	}
	simulated := markup
	price.Markup = &simulated
	clone.Models[upstreamModel] = price
	return &clone
}

// sellPriceView 是一份卖价 + 它换算出来的倍率，给模拟结果用。
type sellPriceView struct {
	Resolved bool     `json:"resolved"`
	Reason   string   `json:"reason,omitempty"`
	Markup   *float64 `json:"markup,omitempty"`
	// 卖价各维度，USD / 1M tokens；per_call 是 USD/次。
	InputUSDPer1M     *float64 `json:"input_usd_per_1m,omitempty"`
	OutputUSDPer1M    *float64 `json:"output_usd_per_1m,omitempty"`
	CacheReadUSDPer1M *float64 `json:"cache_read_usd_per_1m,omitempty"`
	PerCallUSD        *float64 `json:"per_call_usd,omitempty"`
	// Billable 报告这份卖价能否换成计费倍率。false 意味着这笔请求仍按平台倍率
	// 计费——卖价算得出来不等于卖价在收钱。
	Billable        bool     `json:"billable"`
	ModelRatio      *float64 `json:"model_ratio,omitempty"`
	CompletionRatio *float64 `json:"completion_ratio,omitempty"`
	CacheRatio      *float64 `json:"cache_ratio,omitempty"`
}

// resolveSellPriceView 走一遍生产的卖价推导，把结果整理成可序列化的视图。
//
// 这是两个模拟工具共用的那一段：simulate_sell_price 报它，
// simulate_margin_impact 用它的 input 卖价算重定价倍数。
func resolveSellPriceView(cost *dto.ChannelCostSettings, upstreamModel string) sellPriceView {
	sell, ok := model.ResolveSellPrice(cost, upstreamModel)
	if !ok {
		return sellPriceView{
			Reason: "这个渠道-模型没配进价或没配利润率，卖价链不生效，计费走平台倍率（price_source=fallback）",
		}
	}
	markup := sell.Markup
	view := sellPriceView{
		Resolved:          true,
		Markup:            &markup,
		InputUSDPer1M:     sell.Input,
		OutputUSDPer1M:    sell.Output,
		CacheReadUSDPer1M: sell.CacheRead,
		PerCallUSD:        sell.PerCall,
	}

	ratios, ratioOK := model.SellPriceToRatios(sell)
	if !ratioOK {
		if sell.PerCall != nil {
			view.Reason = "按次卖价无法用倍率表达，这笔走按次计价路径"
		} else {
			view.Reason = "卖价缺少 input 维度（或 input 免费而 output 收费），倍率体系表达不了，计费仍走平台倍率"
		}
		return view
	}
	view.Billable = true
	view.ModelRatio = &ratios.ModelRatio
	view.CompletionRatio = ratios.CompletionRatio
	view.CacheRatio = ratios.CacheRatio
	return view
}

// channelCostForSimulation 取一条渠道的成本配置，并把客户端模型名解析成上游模型名。
//
// 进价按上游模型名索引（运营配的是"我们付给上游多少"），所以必须先走一遍
// model_mapping。用 helper.ResolveMappedModelName 而不是自己走链：它是中继和计费
// 共用的那一个函数，各算一次就会在链式映射上分叉，成本悄悄挂到另一个模型上。
func channelCostForSimulation(channelID int, clientModel string) (*model.Channel, *dto.ChannelCostSettings, string, error) {
	channel, err := model.GetChannelById(channelID, false)
	if err != nil {
		return nil, nil, "", fmt.Errorf("渠道 %d 不存在或读取失败: %v", channelID, err)
	}
	settings, err := parseChannelOtherSettings(channel)
	if err != nil {
		return nil, nil, "", err
	}
	upstreamModel, _, err := helper.ResolveMappedModelName(channel.GetModelMapping(), clientModel)
	if err != nil {
		return nil, nil, "", fmt.Errorf("渠道 %d 的 model_mapping 有问题: %v", channelID, err)
	}
	return channel, settings.Cost, upstreamModel, nil
}

func simulateSellPriceTool() Tool {
	return Tool{
		Name: "simulate_sell_price",
		Description: "算一条渠道上某个模型的卖价：卖价 = 进价 × (1 + 利润率)。不传 markup 用渠道/模型已配的利润率，" +
			"传了就按这个利润率试算（不写库）。返回进价、实际用到的利润率、卖价（USD/1M tokens）以及换算出的倍率三元组" +
			"（model_ratio / completion_ratio / cache_ratio），并同时给出当前已配的卖价作为对比。" +
			"注意 billable 字段：它为 false 表示这份卖价换不成计费倍率，这条渠道实际仍按平台倍率收钱。" +
			"markup 填 0 是合法的，含义是平进平出。",
		Parameters: objectSchema(map[string]any{
			"channel_id": map[string]any{
				"type":        "integer",
				"description": "渠道 id。",
				"minimum":     1,
			},
			"model": map[string]any{
				"type":        "string",
				"description": "模型名。会按该渠道的 model_mapping 解析成上游模型名再查进价。",
			},
			"markup": map[string]any{
				"type":        "number",
				"description": fmt.Sprintf("试算用的利润率，0.3 = 加价 30%%。省略则用已配的。范围 0~%g。", maxSimulateMarkup),
				"minimum":     0,
				"maximum":     maxSimulateMarkup,
			},
		}, "channel_id", "model"),
		Handler: handleSimulateSellPrice,
	}
}

func handleSimulateSellPrice(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		ChannelID int      `json:"channel_id"`
		Model     string   `json:"model"`
		Markup    *float64 `json:"markup"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	channelID, err := requireChannelID(in.ChannelID)
	if err != nil {
		return nil, err
	}
	clientModel, err := requireModelName(in.Model)
	if err != nil {
		return nil, err
	}
	if in.Markup != nil {
		if err := validateSimulateMarkup(*in.Markup); err != nil {
			return nil, err
		}
	}

	channel, cost, upstreamModel, err := channelCostForSimulation(channelID, clientModel)
	if err != nil {
		return nil, err
	}

	out := map[string]any{
		"channel_id":     channel.Id,
		"channel_name":   channel.Name,
		"line_code":      channel.GetLineCode(),
		"model":          clientModel,
		"upstream_model": upstreamModel,
		"unit":           "USD per 1M tokens（per_call_usd 为 USD 每次请求）",
	}
	if cost == nil {
		out["stored"] = sellPriceView{Reason: "这条渠道没有成本配置"}
		out["simulated"] = sellPriceView{Reason: "这条渠道没有成本配置，没有进价就推不出卖价"}
		return out, nil
	}

	if purchase, ok := cost.Models[upstreamModel]; ok {
		out["purchase_price"] = purchase
		out["channel_default_markup"] = cost.DefaultMarkup
	} else {
		out["purchase_price"] = nil
		out["note"] = fmt.Sprintf("这条渠道没有上游模型 %q 的进价条目（成本配置按上游模型名索引）", upstreamModel)
	}

	out["stored"] = resolveSellPriceView(cost, upstreamModel)
	if in.Markup == nil {
		out["markup_source"] = "stored"
		out["simulated"] = out["stored"]
		return out, nil
	}
	out["markup_source"] = "caller"
	out["simulated"] = resolveSellPriceView(costSettingsWithMarkup(cost, upstreamModel, *in.Markup), upstreamModel)
	return out, nil
}

// maxSimulateDays 是回放窗口上界，与 controller/cost.go 的 costChannelModelMaxDays
// 同一个数。
const maxSimulateDays = maxWindowDays

func simulateMarginImpactTool() Tool {
	return Tool{
		Name: "simulate_margin_impact",
		Description: "拿一条渠道-模型最近的真实流量，按假设的利润率重算一遍收入和毛利，回答「利润率调到 X 会怎样」。" +
			"只读：不写库、不改配置、不动缓存。返回窗口内的当前收入/成本/毛利 vs 模拟收入/毛利，以及请求数。" +
			"basis 字段说明模拟是怎么算的：sell_price_ratio=按新旧卖价之比缩放真实收入（最准，要求当前已按卖价计费）；" +
			"cost_plus_markup=按 成本×(1+利润率) 估算（当前还没配利润率时只能这么估）。" +
			"两种口径都只覆盖有成本记录的流量，未定价流量（unknown）被排除在外，回答时要带上这个比例。" +
			"金额单位是 quota。",
		Parameters: objectSchema(map[string]any{
			"channel_id": map[string]any{
				"type":        "integer",
				"description": "渠道 id。",
				"minimum":     1,
			},
			"model": map[string]any{
				"type":        "string",
				"description": "模型名。会按该渠道的 model_mapping 解析成上游模型名（毛利事实表也按上游模型名归集）。",
			},
			"markup": map[string]any{
				"type":        "number",
				"description": fmt.Sprintf("假设的利润率，0.3 = 加价 30%%。范围 0~%g。", maxSimulateMarkup),
				"minimum":     0,
				"maximum":     maxSimulateMarkup,
			},
			"days": map[string]any{
				"type":        "integer",
				"description": fmt.Sprintf("回放最近几天的流量，默认 %d，最大 %d。", defaultWindowDays, maxSimulateDays),
				"minimum":     1,
				"maximum":     maxSimulateDays,
			},
		}, "channel_id", "model", "markup"),
		Handler: handleSimulateMarginImpact,
	}
}

func handleSimulateMarginImpact(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		ChannelID int      `json:"channel_id"`
		Model     string   `json:"model"`
		Markup    *float64 `json:"markup"`
		Days      int      `json:"days"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	channelID, err := requireChannelID(in.ChannelID)
	if err != nil {
		return nil, err
	}
	clientModel, err := requireModelName(in.Model)
	if err != nil {
		return nil, err
	}
	if in.Markup == nil {
		return nil, fmt.Errorf("markup 是必填参数（0.3 = 加价 30%%）")
	}
	if err := validateSimulateMarkup(*in.Markup); err != nil {
		return nil, err
	}
	days := in.Days
	if days == 0 {
		days = defaultWindowDays
	}
	if days < 0 || days > maxSimulateDays {
		return nil, fmt.Errorf("days 必须在 1~%d 之间，收到 %d", maxSimulateDays, days)
	}

	channel, cost, upstreamModel, err := channelCostForSimulation(channelID, clientModel)
	if err != nil {
		return nil, err
	}

	end := common.GetTimestamp()
	start := end - int64(days)*secondsPerDay

	// 复用报表那条查询再在 Go 侧筛出这一格：事实表的唯一键是
	// (day, channel, model)，要的行本来就在结果里，不需要为副驾新写一条 SQL
	// （新写就要再过一遍三库方言和参数化）。
	aggs, err := model.GetCostDailyRange(start, end)
	if err != nil {
		return nil, err
	}
	actual := marginRow{ChannelID: channel.Id, ChannelName: channel.Name, ModelName: upstreamModel}
	for _, agg := range aggs {
		if agg.ChannelId != channel.Id || agg.ModelName != upstreamModel {
			continue
		}
		actual.accumulate(agg)
	}
	actual.finalize()

	out := map[string]any{
		"channel_id":     channel.Id,
		"channel_name":   channel.Name,
		"model":          clientModel,
		"upstream_model": upstreamModel,
		"start":          start,
		"end":            end,
		"days":           days,
		"markup":         *in.Markup,
		"current":        actual,
		"quota_per_unit": common.QuotaPerUnit,
	}
	if actual.RequestCount == 0 {
		out["simulated"] = nil
		out["reason"] = "这个窗口内这条渠道-模型没有流量记录，无法回放"
		return out, nil
	}

	stored := resolveSellPriceView(cost, upstreamModel)
	simulated := resolveSellPriceView(costSettingsWithMarkup(cost, upstreamModel, *in.Markup), upstreamModel)
	out["stored_sell_price"] = stored
	out["simulated_sell_price"] = simulated

	basis, factor, ok := repriceFactor(stored, simulated, *in.Markup, actual)
	if !ok {
		out["simulated"] = nil
		out["reason"] = "这条渠道-模型没有可用的进价，给不出模拟卖价，也就算不出模拟毛利"
		return out, nil
	}

	// 按【已定价口径】缩放：未定价流量只记收入不记成本，把它一起缩放等于假设
	// 那部分也按卖价收钱，而它恰恰是还没配价的那部分。
	simulatedRevenue := int64(math.Round(float64(actual.PricedRevenueQuota) * factor))
	if basis == basisCostPlusMarkup {
		simulatedRevenue = int64(math.Round(float64(actual.CostQuota) * (1 + *in.Markup)))
	}
	simulatedMargin := simulatedRevenue - actual.CostQuota

	out["basis"] = basis
	out["simulated"] = map[string]any{
		"priced_revenue_quota": simulatedRevenue,
		"cost_quota":           actual.CostQuota,
		"margin_quota":         simulatedMargin,
		"margin_rate":          marginRateOrNil(simulatedRevenue, simulatedMargin),
		"margin_delta_quota":   simulatedMargin - actual.MarginQuota,
		"revenue_delta_quota":  simulatedRevenue - actual.PricedRevenueQuota,
	}
	out["caveats"] = []string{
		"重定价只覆盖 input/output/cache_read 三个维度（卖价换算的既有边界），音频/图片/缓存写入仍按平台倍率计费",
		"模拟基于窗口内的真实 token 结构，改价本身可能改变用量，这里不预测需求变化",
	}
	return out, nil
}

// 模拟收入的两种口径。
const (
	// basisSellPriceRatio 按新旧卖价之比缩放真实收入。最准：真实收入里已经含了
	// 这个窗口真实的 token 结构（输入输出比、缓存命中率），缩放只换单价。
	basisSellPriceRatio = "sell_price_ratio"
	// basisCostPlusMarkup 按 成本 × (1 + 利润率) 估算。当前还没配利润率（卖价链
	// 没生效）时只能这么估：没有"旧卖价"可比。
	basisCostPlusMarkup = "cost_plus_markup"
)

// repriceFactor 挑一种口径并给出收入缩放倍数。
//
// 倍数不是自己乘出来的：两个 input 卖价都出自 model.ResolveSellPrice，比值天然
// 等于 (1+新利润率)/(1+旧利润率)，但经由那个函数才能带上"缺失维度按官方倍率推导"
// 之类的规则。直接拿调用方给的 markup 算比值会在这些规则上偏掉。
func repriceFactor(stored, simulated sellPriceView, markup float64, actual marginRow) (string, float64, bool) {
	if !simulated.Resolved {
		return "", 0, false
	}
	if stored.Resolved && stored.InputUSDPer1M != nil && simulated.InputUSDPer1M != nil &&
		*stored.InputUSDPer1M > 0 && actual.PricedRevenueQuota > 0 {
		factor := *simulated.InputUSDPer1M / *stored.InputUSDPer1M
		if !math.IsNaN(factor) && !math.IsInf(factor, 0) && factor >= 0 {
			return basisSellPriceRatio, factor, true
		}
	}
	if actual.CostQuota <= 0 {
		return "", 0, false
	}
	return basisCostPlusMarkup, 1 + markup, true
}
