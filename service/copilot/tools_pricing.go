package copilot

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// 模型目录 / 渠道定价 / 渠道进价 —— 四个读工具，都是既有查询的薄包装。

func searchModelsTool() Tool {
	return Tool{
		Name: "search_models",
		Description: "按关键字搜索模型目录（匹配模型名、描述、标签），返回模型名、供应商、启用状态、标签。" +
			"用于把运营口中的模型名对到库里真实存在的那一个 —— 后面几个定价工具都要求准确的模型名。" +
			"不返回价格，价格看 get_model_pricing。",
		Parameters: objectSchema(map[string]any{
			"keyword": map[string]any{
				"type":        "string",
				"description": "模型名/描述/标签的子串。留空返回最近创建的若干个模型。",
			},
			"limit": map[string]any{
				"type":        "integer",
				"description": fmt.Sprintf("返回条数，默认 %d，最大 %d。", defaultListLimit, maxListLimit),
				"minimum":     1,
				"maximum":     maxListLimit,
			},
		}),
		Handler: handleSearchModels,
	}
}

func handleSearchModels(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		Keyword string `json:"keyword"`
		Limit   int    `json:"limit"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	limit, err := resolveLimit(in.Limit)
	if err != nil {
		return nil, err
	}

	// 与 controller.SearchModelsMeta 同一个查询；这里不需要 enrichModels 那套
	// 端点/渠道/分组回填，模型问的是"有没有这个模型、叫什么"。
	models, total, err := model.SearchModels(strings.TrimSpace(in.Keyword), "", "", "", 0, limit)
	if err != nil {
		return nil, err
	}

	vendorNames := map[int]string{}
	if vendors, vendorErr := model.GetAllVendors(0, maxListLimit*5); vendorErr == nil {
		for _, vendor := range vendors {
			vendorNames[vendor.Id] = vendor.Name
		}
	}

	type modelRow struct {
		ModelName string   `json:"model_name"`
		Vendor    string   `json:"vendor,omitempty"`
		Status    string   `json:"status"`
		Tags      []string `json:"tags,omitempty"`
	}
	items := make([]modelRow, 0, len(models))
	for _, meta := range models {
		if meta == nil {
			continue
		}
		row := modelRow{ModelName: meta.ModelName, Vendor: vendorNames[meta.VendorID], Status: "disabled"}
		if meta.Status == 1 {
			row.Status = "enabled"
		}
		for _, tag := range strings.Split(meta.Tags, ",") {
			if tag = strings.TrimSpace(tag); tag != "" {
				row.Tags = append(row.Tags, tag)
			}
		}
		items = append(items, row)
	}

	return map[string]any{
		"items":       items,
		"returned":    len(items),
		"total_match": total,
	}, nil
}

func getModelPricingTool() Tool {
	return Tool{
		Name: "get_model_pricing",
		Description: "查一个模型在每条渠道上的实际定价，按价格从低到高（与低价路由的候选顺序一致）。" +
			"每行给渠道 id、名称、线路码，以及 price_source：exact=渠道+模型精确折扣、channel=渠道级折扣、" +
			"cost=进价×(1+利润率) 正推出来的卖价、fallback=没配任何东西，还在走平台倍率老计费。" +
			"price_source 是这个工具最重要的字段：fallback 行说明这条渠道的定价没生效，不要把它的价当成运营配的价。" +
			"同时返回平台倍率与官方倍率（含单价 USD/1M tokens）作为对比基准。",
		Parameters: objectSchema(map[string]any{
			"model": map[string]any{
				"type":        "string",
				"description": "对外的模型名（客户端请求里写的那个）。",
			},
		}, "model"),
		Handler: handleGetModelPricing,
	}
}

func handleGetModelPricing(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		Model string `json:"model"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	modelName, err := requireModelName(in.Model)
	if err != nil {
		return nil, err
	}

	// 与广场目录页同一个入口：价格、排序、可比性判据全部一致，副驾说出来的顺序
	// 就是路由实际走的顺序。
	routes := service.GetModelChannelRoutes(modelName, adminReachableGroups())

	type channelPriceRow struct {
		ChannelID     int      `json:"channel_id"`
		Name          string   `json:"name,omitempty"`
		LineCode      string   `json:"line_code,omitempty"`
		UpstreamModel string   `json:"upstream_model,omitempty"`
		PriceSource   string   `json:"price_source"`
		ModelRatio    float64  `json:"model_ratio"`
		InputUSDPer1M float64  `json:"input_usd_per_1m"`
		Discount      *float64 `json:"discount,omitempty"`
		PerCallUSD    *float64 `json:"per_call_usd,omitempty"`
		PriceUnset    bool     `json:"price_unset,omitempty"`
		// Comparable 说明这一行的价能不能参与排序。fallback（每条渠道同一个数）
		// 和按次价（单位不同）都不能，路由对它们只能按 priority 排。
		Comparable bool     `json:"comparable"`
		Groups     []string `json:"groups,omitempty"`
	}

	rows := make([]channelPriceRow, 0, len(routes))
	for _, route := range routes {
		if route == nil {
			continue
		}
		if len(rows) >= maxListLimit {
			break
		}
		row := channelPriceRow{
			ChannelID:     route.ChannelID,
			Name:          route.Name,
			LineCode:      route.Code,
			UpstreamModel: route.Price.UpstreamModel,
			PriceSource:   route.Price.Source,
			ModelRatio:    route.Price.ModelRatio,
			InputUSDPer1M: usdPer1MFromRatio(route.Price.ModelRatio),
			Discount:      route.Price.Discount,
			PriceUnset:    route.Price.PriceUnset,
			Comparable:    route.Price.Comparable(),
			Groups:        route.Groups,
		}
		if route.Price.QuotaType == 1 {
			perCall := route.Price.ModelPrice
			row.PerCallUSD = &perCall
			// 按次计价时倍率没有意义，报 0 会被读成"免费"。
			row.ModelRatio = 0
			row.InputUSDPer1M = 0
		}
		rows = append(rows, row)
	}

	out := map[string]any{
		"model":         modelName,
		"channels":      rows,
		"channel_count": len(routes),
		"truncated":     len(routes) > len(rows),
		// 路由策略与"这个模型的渠道价差够不够排序"。ranked=false + enabled=true
		// 是常见状态：开关开着，但没有渠道配过价，路由实际还在按 priority 走。
		"auto_route": service.GetModelAutoRouteInfo(routes),
		"platform":   platformRatioSnapshot(modelName),
		"official":   officialRatioSnapshot(modelName),
	}
	return out, nil
}

// platformRatioSnapshot 是模型定价页里填的那套倍率（本站自己的售价口径）。
func platformRatioSnapshot(modelName string) map[string]any {
	snapshot := map[string]any{}
	if perCall, found := ratio_setting.GetModelPrice(modelName, false); found {
		snapshot["quota_type"] = "per_call"
		snapshot["per_call_usd"] = perCall
		return snapshot
	}
	snapshot["quota_type"] = "per_token"
	modelRatio, found, _ := ratio_setting.GetModelRatio(modelName)
	if !found {
		// GetModelRatio 命中不到时返回 37.5 兜底值，把它当"平台价"报出去就是
		// 让模型拿一个没人配过的数去算折扣（model/pricing.go:405 的同一个坑）。
		snapshot["ratio_unset"] = true
		return snapshot
	}
	snapshot["model_ratio"] = modelRatio
	snapshot["input_usd_per_1m"] = usdPer1MFromRatio(modelRatio)
	completionRatio := ratio_setting.GetCompletionRatio(modelName)
	snapshot["completion_ratio"] = completionRatio
	snapshot["output_usd_per_1m"] = usdPer1MFromRatio(modelRatio * completionRatio)
	if cacheRatio, ok := ratio_setting.GetCacheRatio(modelName); ok {
		snapshot["cache_ratio"] = cacheRatio
		snapshot["cache_read_usd_per_1m"] = usdPer1MFromRatio(modelRatio * cacheRatio)
	}
	return snapshot
}

func listChannelsTool() Tool {
	return Tool{
		Name: "list_channels",
		Description: "列出渠道，可按模型过滤到「能跑这个模型的渠道」。返回 id、名称、类型编号、状态" +
			"（enabled/manually_disabled/auto_disabled）、优先级、线路码、分组，以及这条渠道有没有配过进价/折扣。" +
			"不返回密钥、余额和上游地址。按模型过滤时看的是渠道自己配的模型列表，因此禁用中的渠道也会列出来。",
		Parameters: objectSchema(map[string]any{
			"model": map[string]any{
				"type":        "string",
				"description": "只列服务这个模型的渠道。留空列全部渠道。",
			},
			"limit": map[string]any{
				"type":        "integer",
				"description": fmt.Sprintf("返回条数，默认 %d，最大 %d。", defaultListLimit, maxListLimit),
				"minimum":     1,
				"maximum":     maxListLimit,
			},
		}),
		Handler: handleListChannels,
	}
}

func handleListChannels(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		Model string `json:"model"`
		Limit int    `json:"limit"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	limit, err := resolveLimit(in.Limit)
	if err != nil {
		return nil, err
	}
	modelName := strings.TrimSpace(in.Model)

	// selectAll=false 让查询 Omit("key")：渠道密钥绝不能进模型上下文。
	channels, err := model.GetAllChannels(0, maxListLimit*10, false, true)
	if err != nil {
		return nil, err
	}

	type channelRow struct {
		Id       int      `json:"id"`
		Name     string   `json:"name"`
		Type     int      `json:"type"`
		Status   string   `json:"status"`
		Priority int64    `json:"priority"`
		LineCode string   `json:"line_code,omitempty"`
		Groups   []string `json:"groups,omitempty"`
		// HasCostConfig / HasPriceConfig 是"这条渠道配过进价 / 配过折扣"。运营问
		// "为什么这条线没按我配的价卖"时，第一件要确认的就是它到底配没配。
		HasCostConfig  bool `json:"has_cost_config"`
		HasPriceConfig bool `json:"has_price_config"`
	}

	rows := make([]channelRow, 0, limit)
	matched := 0
	for _, channel := range channels {
		if channel == nil {
			continue
		}
		if modelName != "" && !channelServesModel(channel.Models, modelName) {
			continue
		}
		matched++
		if len(rows) >= limit {
			continue
		}
		row := channelRow{
			Id:       channel.Id,
			Name:     channel.Name,
			Type:     channel.Type,
			Status:   channelStatusLabel(channel.Status),
			Priority: channel.GetPriority(),
			LineCode: channel.GetLineCode(),
		}
		for _, group := range strings.Split(channel.Group, ",") {
			if group = strings.TrimSpace(group); group != "" {
				row.Groups = append(row.Groups, group)
			}
		}
		if settings, settingsErr := parseChannelOtherSettings(channel); settingsErr == nil {
			row.HasCostConfig = settings.Cost != nil && len(settings.Cost.Models) > 0
			row.HasPriceConfig = settings.Price != nil
		}
		rows = append(rows, row)
	}

	return map[string]any{
		"items":     rows,
		"returned":  len(rows),
		"matched":   matched,
		"truncated": matched > len(rows),
	}, nil
}

// channelServesModel 判断渠道的模型列表是否精确包含这个模型。
//
// 逐项比对而不是 LIKE：`models` 是逗号分隔的一列，`gpt-4` 的子串匹配会把
// `gpt-4o`、`gpt-4-turbo` 全算进来，而运营问的是"哪几条线能跑 gpt-4"。
func channelServesModel(models string, modelName string) bool {
	for _, candidate := range strings.Split(models, ",") {
		if strings.TrimSpace(candidate) == modelName {
			return true
		}
	}
	return false
}

func channelStatusLabel(status int) string {
	switch status {
	case 1:
		return "enabled"
	case 2:
		return "manually_disabled"
	case 3:
		return "auto_disabled"
	default:
		return fmt.Sprintf("unknown(%d)", status)
	}
}

func getChannelCostTool() Tool {
	return Tool{
		Name: "get_channel_cost",
		Description: "查一条渠道的成本配置：default_markup（渠道级利润率，0.3 = 加价 30%）和按上游模型名的进价" +
			"（USD / 1M tokens，per_call 是 USD/次）。卖价 = 进价 × (1 + 利润率)，利润率可被单个模型的 markup 覆盖。" +
			"这些是进价（我们付给上游的钱），仅管理员可见，禁止透露给客户或写进对外文案。" +
			"models 的键是上游模型名（经过 model_mapping 之后的名字），不一定等于对外模型名。",
		Parameters: objectSchema(map[string]any{
			"channel_id": map[string]any{
				"type":        "integer",
				"description": "渠道 id。",
				"minimum":     1,
			},
		}, "channel_id"),
		Handler: handleGetChannelCost,
	}
}

func handleGetChannelCost(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		ChannelID int `json:"channel_id"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	channelID, err := requireChannelID(in.ChannelID)
	if err != nil {
		return nil, err
	}
	channel, err := model.GetChannelById(channelID, false)
	if err != nil {
		return nil, fmt.Errorf("渠道 %d 不存在或读取失败: %v", channelID, err)
	}
	settings, err := parseChannelOtherSettings(channel)
	if err != nil {
		return nil, err
	}

	out := map[string]any{
		"channel_id": channel.Id,
		"name":       channel.Name,
		"line_code":  channel.GetLineCode(),
	}
	if settings.Cost == nil {
		out["configured"] = false
		// 没配进价不是"进价为 0"，而是这条渠道的卖价链整条不生效、仍走平台倍率。
		out["note"] = "这条渠道没有成本配置，卖价链不生效，计费走平台倍率（price_source=fallback）"
		return out, nil
	}

	out["configured"] = true
	out["default_markup"] = settings.Cost.DefaultMarkup
	out["updated_at"] = settings.Cost.UpdatedAt
	if settings.Cost.Currency != "" {
		out["currency"] = settings.Cost.Currency
	} else {
		out["currency"] = "USD"
	}

	names := make([]string, 0, len(settings.Cost.Models))
	for name := range settings.Cost.Models {
		names = append(names, name)
	}
	sort.Strings(names)

	type costRow struct {
		UpstreamModel string   `json:"upstream_model"`
		Input         *float64 `json:"input,omitempty"`
		Output        *float64 `json:"output,omitempty"`
		CacheRead     *float64 `json:"cache_read,omitempty"`
		CacheWrite5m  *float64 `json:"cache_write_5m,omitempty"`
		CacheWrite1h  *float64 `json:"cache_write_1h,omitempty"`
		AudioIn       *float64 `json:"audio_in,omitempty"`
		AudioOut      *float64 `json:"audio_out,omitempty"`
		ImageIn       *float64 `json:"image_in,omitempty"`
		ImageOut      *float64 `json:"image_out,omitempty"`
		Reasoning     *float64 `json:"reasoning,omitempty"`
		PerCall       *float64 `json:"per_call,omitempty"`
		Markup        *float64 `json:"markup,omitempty"`
	}
	rows := make([]costRow, 0, len(names))
	for _, name := range names {
		if len(rows) >= maxListLimit {
			break
		}
		price := settings.Cost.Models[name]
		rows = append(rows, costRow{
			UpstreamModel: name,
			Input:         price.Input,
			Output:        price.Output,
			CacheRead:     price.CacheRead,
			CacheWrite5m:  price.CacheWrite5m,
			CacheWrite1h:  price.CacheWrite1h,
			AudioIn:       price.AudioIn,
			AudioOut:      price.AudioOut,
			ImageIn:       price.ImageIn,
			ImageOut:      price.ImageOut,
			Reasoning:     price.Reasoning,
			PerCall:       price.PerCall,
			Markup:        price.Markup,
		})
	}
	out["models"] = rows
	out["model_count"] = len(names)
	out["truncated"] = len(names) > len(rows)
	out["unit"] = "USD per 1M tokens（per_call 为 USD 每次请求）"
	return out, nil
}

func getOfficialPriceTool() Tool {
	return Tool{
		Name: "get_official_price",
		Description: "查一个模型的官方价（上游厂商的公开标价），返回输入/输出/缓存读取三档的倍率与 USD/1M tokens 单价，" +
			"并附上 synced_at（上次同步的 unix 秒）和 stale_days（距今几天）。" +
			"必须先看 stale_days 再引用这个价：官方价只由同步任务写入，几天不同步就是过期数据，" +
			"拿过期官方价当现价算出来的折扣是错的。stale_days 超过 1~2 天就要在回答里说明数据日期，别当现价断言。" +
			"官方价只用于折扣展示和毛利分母，不参与计费。",
		Parameters: objectSchema(map[string]any{
			"model": map[string]any{
				"type":        "string",
				"description": "模型名。官方价按上游模型名收录，通常与对外模型名相同。",
			},
		}, "model"),
		Handler: handleGetOfficialPrice,
	}
}

func handleGetOfficialPrice(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		Model string `json:"model"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	modelName, err := requireModelName(in.Model)
	if err != nil {
		return nil, err
	}

	out := map[string]any{
		"model":    modelName,
		"official": officialRatioSnapshot(modelName),
		"platform": platformRatioSnapshot(modelName),
	}
	return out, nil
}

// officialRatioSnapshot 读官方价三项 + 同步时效。
//
// synced_at / stale_days 不是可选的附加信息：官方价表整表由同步任务替换
// （setting/ratio_setting/official_ratio.go），没有手填入口，所以一个模型的官方价
// 只可能和最后一次同步同龄。报价却不报日期，模型就会把几天前的数当现价，然后
// 用它算出一个自信但错误的折扣。
func officialRatioSnapshot(modelName string) map[string]any {
	snapshot := map[string]any{}

	syncedAt := ratio_setting.GetOfficialRatioSyncedAt()
	snapshot["synced_at"] = syncedAt
	if syncedAt <= 0 {
		snapshot["synced"] = false
		snapshot["stale_days"] = nil
		snapshot["note"] = "官方价从未同步过，下面的价格要么缺失要么来自历史导入，不能当现价用"
	} else {
		snapshot["synced"] = true
		staleSeconds := common.GetTimestamp() - syncedAt
		if staleSeconds < 0 {
			staleSeconds = 0
		}
		snapshot["stale_days"] = staleSeconds / secondsPerDay
	}

	modelRatio, hasModel := ratio_setting.GetOfficialModelRatio(modelName)
	if !hasModel {
		snapshot["available"] = false
		snapshot["note_missing"] = "这个模型没有官方价记录，无法计算折扣，不要自己估一个"
		return snapshot
	}
	snapshot["available"] = true
	snapshot["model_ratio"] = modelRatio
	snapshot["input_usd_per_1m"] = usdPer1MFromRatio(modelRatio)
	if completionRatio, ok := ratio_setting.GetOfficialCompletionRatio(modelName); ok {
		snapshot["completion_ratio"] = completionRatio
		snapshot["output_usd_per_1m"] = usdPer1MFromRatio(modelRatio * completionRatio)
	}
	if cacheRatio, ok := ratio_setting.GetOfficialCacheRatio(modelName); ok {
		snapshot["cache_ratio"] = cacheRatio
		snapshot["cache_read_usd_per_1m"] = usdPer1MFromRatio(modelRatio * cacheRatio)
	}
	return snapshot
}
