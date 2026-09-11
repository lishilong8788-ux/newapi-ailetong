package service

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// RecalculateCostDaily 按时间范围从 logs 明细重算 channel_cost_daily。
// 用途：改了成本价后回溯修正历史毛利。
//
// 边界：依赖 logs 还在（一键 DELETE / ClickHouse TTL 会清），调用方需提示
// 可回溯范围。重算用当前的成本配置，不是历史时点配置——这是有意为之：
// recalculate 的语义就是"按新价格重看历史"。
func RecalculateCostDaily(startTs, endTs int64) (int, error) {
	const batchSize = 500
	// 逐批扫 consume 日志，按 (day, channel, upstream_model) 聚合，先删后写。
	aggregates := map[model.CostDailyAgg]*model.ChannelCostDaily{}
	total := 0
	offset := 0
	for {
		logs, _, err := model.GetLogsForCostRecalc(startTs, endTs, offset, batchSize)
		if err != nil {
			return 0, err
		}
		if len(logs) == 0 {
			break
		}
		for _, log := range logs {
			total++
			other, costInfo, upstreamModel := parseLogForCostRecalc(log)
			if other == nil {
				continue
			}
			dayTs := log.CreatedAt / 86400 * 86400
			key := model.CostDailyAgg{ChannelId: log.ChannelId, ModelName: upstreamModel, DayTs: dayTs}
			agg, ok := aggregates[key]
			if !ok {
				agg = &model.ChannelCostDaily{
					DayTs:     dayTs,
					ChannelId: log.ChannelId,
					ModelName: upstreamModel,
				}
				aggregates[key] = agg
			}
			agg.RequestCount++
			agg.TokenUsed += int64(log.PromptTokens + log.CompletionTokens)
			agg.RevenueQuota += int64(log.Quota)
			if costQuota, okc := costInfo["cost_quota"].(float64); okc {
				agg.CostQuota += int64(costQuota)
			}
			if source, oks := costInfo["cost_source"].(string); oks && source == "unknown" {
				agg.UnknownCount++
				agg.UnknownQuota += int64(log.Quota)
			}
			if reported, okr := costInfo["cost_reported"].(float64); okr {
				agg.ReportedQuota += int64(reported)
			}
		}
		if len(logs) < batchSize {
			break
		}
		offset += batchSize
	}

	// 先删后写：范围内旧行全部作废。多实例并发重算同一范围会互相覆盖但
	// 结果幂等（同源数据 + 同配置）。
	if err := model.DeleteCostDailyRange(startTs, endTs); err != nil {
		return 0, err
	}
	for _, agg := range aggregates {
		if err := model.UpsertChannelCostDaily(agg); err != nil {
			return 0, fmt.Errorf("recalc upsert failed: %w", err)
		}
	}
	return total, nil
}

// parseLogForCostRecalc 解析一条 consume 日志的 other 字段，返回
// (otherMap, costInfo, upstreamModel)。
func parseLogForCostRecalc(log *model.Log) (map[string]interface{}, map[string]interface{}, string) {
	if log.Other == "" {
		return nil, nil, ""
	}
	var other map[string]interface{}
	if err := common.UnmarshalJsonStr(log.Other, &other); err != nil {
		return nil, nil, ""
	}
	// 渠道测试与 playground 不进毛利统计。
	if source, ok := other["traffic_source"].(string); ok && (source == "channel_test" || source == "playground") {
		return nil, nil, ""
	}
	upstreamModel := log.ModelName
	if name, ok := other["upstream_model_name"].(string); ok && name != "" {
		upstreamModel = name
	}
	costInfo := map[string]interface{}{}
	if adminInfo, ok := other["admin_info"].(map[string]interface{}); ok {
		if cost, okc := adminInfo["cost"].(map[string]interface{}); okc {
			costInfo = cost
		}
	}
	return other, costInfo, upstreamModel
}

// RecomputeLogCost 用当前成本配置重算一条历史日志的成本（不落库，预览用）。
// 改价后的批量回溯走 RecalculateCostDaily（从 admin_info.cost 快照聚合）。
func RecomputeLogCost(log *model.Log, cost *dto.ChannelCostSettings) (int, string) {
	_, costInfo, _ := parseLogForCostRecalc(log)
	if costInfo == nil {
		return 0, "unknown"
	}
	if source, ok := costInfo["cost_source"].(string); ok {
		if quota, okq := costInfo["cost_quota"].(float64); okq {
			return int(quota), source
		}
	}
	return 0, "unknown"
}
