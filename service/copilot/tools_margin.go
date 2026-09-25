package copilot

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// 毛利与总览。数据源是 channel_cost_daily 日汇总事实表，与 /api/cost/* 完全同源：
// model.GetCostDailyByChannel / GetCostDailyRange / GetCostDailyTrend。
//
// 毛利口径也与那边一致（pricedMargin），见下方注释。

// pricedMargin 按【已定价口径】算毛利：分子分母都要先剔掉未定价流量的收入。
//
// 这段算术与 controller/cost.go 的 pricedMargin 是同一个口径，刻意重写一遍而不是
// 调用它：service 不能 import controller（会成环），而把它上提到 service 会动到
// 六个报表 handler，不属于副驾这一步的改动范围。两处一旦分叉，副驾说的毛利就和
// 报表页显示的毛利不一样——所以口径写在这里一次，两个工具共用。
//
// 为什么必须剔：未定价流量（cost_source=unknown）的收入照常累加进 RevenueQuota，
// 成本却被 RecordCostSample 跳过，全额口径会把这部分收入整笔当成纯利。一条渠道
// 收入 400 成本 380、其中 200 未定价，全额算 +5%，剔掉后真实是 -90%，方向正好是
// 最危险的那一侧（毛利虚高让亏损渠道看起来健康）。
//
// unknownRevenue 取 UnknownQuota：该字段存的是这些请求的【收入】而不是成本。
func pricedMargin(revenue, cost, unknownRevenue int64) (margin int64, base int64) {
	base = revenue - unknownRevenue
	if base < 0 {
		base = 0
	}
	return base - cost, base
}

func marginRateOrNil(base int64, margin int64) *float64 {
	if base <= 0 {
		return nil
	}
	rate := float64(margin) / float64(base)
	return &rate
}

func rateOrNil(total int64, part int64) *float64 {
	if total <= 0 {
		return nil
	}
	rate := float64(part) / float64(total)
	return &rate
}

// marginRow 是毛利明细的一行，三种 group_by 共用一个结构。
type marginRow struct {
	ChannelID   int    `json:"channel_id,omitempty"`
	ChannelName string `json:"channel_name,omitempty"`
	ModelName   string `json:"model_name,omitempty"`

	RequestCount int64 `json:"request_count"`
	TokenUsed    int64 `json:"token_used"`
	RevenueQuota int64 `json:"revenue_quota"`
	CostQuota    int64 `json:"cost_quota"`
	MarginQuota  int64 `json:"margin_quota"`
	// PricedRevenueQuota 是毛利率的分母：收入扣掉未定价流量的收入。
	PricedRevenueQuota int64    `json:"priced_revenue_quota"`
	MarginRate         *float64 `json:"margin_rate"`
	// UnknownCount / UnknownQuota / UnknownRate 是未定价流量。这一列不是附注：
	// 未定价占比高时上面的毛利率只覆盖了一部分流量，不能当整体结论。
	UnknownCount int64    `json:"unknown_count"`
	UnknownQuota int64    `json:"unknown_quota"`
	UnknownRate  *float64 `json:"unknown_rate"`
}

func (r *marginRow) accumulate(agg model.CostDailyAgg) {
	r.RequestCount += agg.RequestCount
	r.TokenUsed += agg.TokenUsed
	r.RevenueQuota += agg.RevenueQuota
	r.CostQuota += agg.CostQuota
	r.UnknownCount += agg.UnknownCount
	r.UnknownQuota += agg.UnknownQuota
}

func (r *marginRow) finalize() {
	margin, base := pricedMargin(r.RevenueQuota, r.CostQuota, r.UnknownQuota)
	r.MarginQuota = margin
	r.PricedRevenueQuota = base
	r.MarginRate = marginRateOrNil(base, margin)
	r.UnknownRate = rateOrNil(r.RequestCount, r.UnknownCount)
}

const (
	groupByChannel      = "channel"
	groupByModel        = "model"
	groupByChannelModel = "channel_model"
)

func queryMarginTool() Tool {
	return Tool{
		Name: "query_margin",
		Description: "按渠道 / 模型 / 渠道×模型聚合毛利。返回每行的收入、成本、毛利、毛利率、请求数，" +
			"以及未定价流量（unknown_count / unknown_quota / unknown_rate）。" +
			"毛利率的分母是 priced_revenue_quota（收入扣掉未定价流量的收入），不是总收入：" +
			"未定价流量只记收入不记成本，算进去会让亏损渠道显示成盈利。" +
			"因此 unknown_rate 高的行，它的毛利率只代表一部分流量，必须连同这个比例一起说，" +
			"否则就是在用配置缺失掩盖真实毛利。金额单位是 quota（除以 quota_per_unit 得 USD）。" +
			"逐渠道定价下每条线的毛利率应当等于 markup/(1+markup)，出现负毛利就是真有问题（进价填错或回落了老计费）。",
		Parameters: objectSchema(map[string]any{
			"start": map[string]any{
				"type":        "integer",
				"description": fmt.Sprintf("起始 unix 秒。与 end 任一缺失则取最近 %d 天。", defaultWindowDays),
			},
			"end": map[string]any{
				"type":        "integer",
				"description": "结束 unix 秒。",
			},
			"group_by": map[string]any{
				"type":        "string",
				"description": "聚合维度：channel（按渠道）、model（按模型）、channel_model（交叉，回答「同一个模型哪条线更赚」）。",
				"enum":        []string{groupByChannel, groupByModel, groupByChannelModel},
			},
		}, "group_by"),
		Handler: handleQueryMargin,
	}
}

func handleQueryMargin(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		Start   int64  `json:"start"`
		End     int64  `json:"end"`
		GroupBy string `json:"group_by"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	groupBy := strings.TrimSpace(in.GroupBy)
	switch groupBy {
	case groupByChannel, groupByModel, groupByChannelModel:
	case "":
		return nil, fmt.Errorf("group_by 是必填参数，取值 %s / %s / %s", groupByChannel, groupByModel, groupByChannelModel)
	default:
		return nil, fmt.Errorf("group_by 取值非法：%q，只能是 %s / %s / %s", groupBy, groupByChannel, groupByModel, groupByChannelModel)
	}
	start, end, err := resolveWindow(in.Start, in.End)
	if err != nil {
		return nil, err
	}

	rows, err := aggregateMargin(groupBy, start, end)
	if err != nil {
		return nil, err
	}

	// 收入降序：运营先看的总是量最大的那几行。毛利排序在 Go 侧做的理由同
	// controller.CostChannelModels——SQL 里的 SUM(revenue)-SUM(cost) 与这里显示的
	// 毛利不是一个口径，按它排出来的名次会和列里的数字打架。
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].RevenueQuota != rows[j].RevenueQuota {
			return rows[i].RevenueQuota > rows[j].RevenueQuota
		}
		if rows[i].ChannelID != rows[j].ChannelID {
			return rows[i].ChannelID < rows[j].ChannelID
		}
		return rows[i].ModelName < rows[j].ModelName
	})

	total := marginRow{}
	for _, row := range rows {
		total.RequestCount += row.RequestCount
		total.TokenUsed += row.TokenUsed
		total.RevenueQuota += row.RevenueQuota
		total.CostQuota += row.CostQuota
		total.UnknownCount += row.UnknownCount
		total.UnknownQuota += row.UnknownQuota
	}
	total.finalize()

	// 合计在截断之前算完：截断后再求和会让"合计"只是前 N 行的和，那是个会被
	// 当成全量结论引用的错数。
	returned := rows
	if len(returned) > maxListLimit {
		returned = returned[:maxListLimit]
	}

	return map[string]any{
		"start":          start,
		"end":            end,
		"group_by":       groupBy,
		"rows":           returned,
		"row_count":      len(rows),
		"truncated":      len(rows) > len(returned),
		"total":          total,
		"quota_per_unit": common.QuotaPerUnit,
	}, nil
}

// aggregateMargin 把日汇总行折到请求的维度上。
//
// channel 维直接用 model.GetCostDailyByChannel（SQL 侧聚完）；另两个维用
// GetCostDailyRange 拿 (channel, model, day) 明细再在 Go 侧压掉 day —— 事实表的
// 唯一键本来就是这三元组，压维不需要新写一条 SQL，也就不需要再过一遍三库方言。
func aggregateMargin(groupBy string, start, end int64) ([]*marginRow, error) {
	if groupBy == groupByChannel {
		aggs, err := model.GetCostDailyByChannel(start, end)
		if err != nil {
			return nil, err
		}
		names := channelNamesByID()
		rows := make([]*marginRow, 0, len(aggs))
		for _, agg := range aggs {
			row := &marginRow{ChannelID: agg.ChannelId, ChannelName: channelDisplayName(names, agg.ChannelId)}
			row.accumulate(agg)
			row.finalize()
			rows = append(rows, row)
		}
		return rows, nil
	}

	aggs, err := model.GetCostDailyRange(start, end)
	if err != nil {
		return nil, err
	}
	var names map[int]string
	if groupBy == groupByChannelModel {
		names = channelNamesByID()
	}
	byKey := map[string]*marginRow{}
	ordered := make([]*marginRow, 0, len(aggs))
	for _, agg := range aggs {
		key := agg.ModelName
		if groupBy == groupByChannelModel {
			key = fmt.Sprintf("%d\x00%s", agg.ChannelId, agg.ModelName)
		}
		row, ok := byKey[key]
		if !ok {
			row = &marginRow{ModelName: agg.ModelName}
			if groupBy == groupByChannelModel {
				row.ChannelID = agg.ChannelId
				row.ChannelName = channelDisplayName(names, agg.ChannelId)
			}
			byKey[key] = row
			ordered = append(ordered, row)
		}
		row.accumulate(agg)
	}
	for _, row := range ordered {
		row.finalize()
	}
	return ordered, nil
}

// channelDisplayName 给渠道 id 配一个名字。渠道删了但账还在是正常状态
// （controller.CostChannelModels 同样处理），给个可辨识的占位而不是空字符串。
func channelDisplayName(names map[int]string, channelID int) string {
	if name, ok := names[channelID]; ok && name != "" {
		return name
	}
	return fmt.Sprintf("#%d (deleted)", channelID)
}

func queryCostOverviewTool() Tool {
	return Tool{
		Name: "query_cost_overview",
		Description: "成本毛利总览：时间窗内的总收入、总成本、毛利、毛利率、请求数、未定价流量占比，外加按天的趋势。" +
			"毛利率口径与 query_margin 相同（分母是扣掉未定价收入后的 priced_revenue_quota）。" +
			"金额单位是 quota，除以 quota_per_unit 得 USD。先用这个拿全局盘子，再用 query_margin 下钻到渠道或模型。",
		Parameters: objectSchema(map[string]any{
			"start": map[string]any{
				"type":        "integer",
				"description": fmt.Sprintf("起始 unix 秒。与 end 任一缺失则取最近 %d 天。", defaultWindowDays),
			},
			"end": map[string]any{
				"type":        "integer",
				"description": "结束 unix 秒。",
			},
		}),
		Handler: handleQueryCostOverview,
	}
}

// maxTrendDays 是趋势里最多带几个日桶。默认窗口是 30 天，所以常规调用不会被截；
// 366 天的窗口逐日列出来只会把上下文塞满，取最近的一段。
const maxTrendDays = 31

func handleQueryCostOverview(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		Start int64 `json:"start"`
		End   int64 `json:"end"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	start, end, err := resolveWindow(in.Start, in.End)
	if err != nil {
		return nil, err
	}

	// 与 controller.CostOverview / CostTrend 同一个查询：一次取按天聚合的行，
	// 求和得总览，原样得趋势。
	aggs, err := model.GetCostDailyTrend(start, end)
	if err != nil {
		return nil, err
	}

	type trendPoint struct {
		DayTs        int64 `json:"day_ts"`
		RequestCount int64 `json:"request_count"`
		RevenueQuota int64 `json:"revenue_quota"`
		CostQuota    int64 `json:"cost_quota"`
		MarginQuota  int64 `json:"margin_quota"`
		UnknownQuota int64 `json:"unknown_quota"`
	}

	total := marginRow{}
	trend := make([]trendPoint, 0, len(aggs))
	for _, agg := range aggs {
		total.accumulate(agg)
		dayMargin, _ := pricedMargin(agg.RevenueQuota, agg.CostQuota, agg.UnknownQuota)
		trend = append(trend, trendPoint{
			DayTs:        agg.DayTs,
			RequestCount: agg.RequestCount,
			RevenueQuota: agg.RevenueQuota,
			CostQuota:    agg.CostQuota,
			MarginQuota:  dayMargin,
			UnknownQuota: agg.UnknownQuota,
		})
	}
	total.finalize()

	trendTruncated := false
	if len(trend) > maxTrendDays {
		trend = trend[len(trend)-maxTrendDays:]
		trendTruncated = true
	}

	return map[string]any{
		"start":                start,
		"end":                  end,
		"request_count":        total.RequestCount,
		"token_used":           total.TokenUsed,
		"revenue_quota":        total.RevenueQuota,
		"cost_quota":           total.CostQuota,
		"margin_quota":         total.MarginQuota,
		"priced_revenue_quota": total.PricedRevenueQuota,
		"margin_rate":          total.MarginRate,
		"unknown_count":        total.UnknownCount,
		"unknown_quota":        total.UnknownQuota,
		"unknown_rate":         total.UnknownRate,
		"revenue_usd":          quotaToUSD(total.RevenueQuota),
		"cost_usd":             quotaToUSD(total.CostQuota),
		"margin_usd":           quotaToUSD(total.MarginQuota),
		"trend":                trend,
		"trend_truncated":      trendTruncated,
		"quota_per_unit":       common.QuotaPerUnit,
	}, nil
}
