package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// 成本毛利接口。查询类挂 AdminAuth（与 /log /data 同级），写类挂 RootAuth
// （性质等同 /option 与渠道敏感写）。middleware/auth.go 的兜底审计对
// AdminAuth 及以上自动留痕。

func parseCostTimeRange(c *gin.Context, defaultDays int) (int64, int64, bool) {
	startTs, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTs, err2 := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || err2 != nil || startTs <= 0 || endTs <= 0 {
		// 默认最近 N 天
		endTs = time.Now().Unix()
		startTs = endTs - int64(defaultDays)*86400
	}
	if endTs < startTs {
		common.ApiErrorMsg(c, "invalid time range")
		return 0, 0, false
	}
	return startTs, endTs, true
}

// CostOverview 总览：收入/成本/毛利/毛利率/未定价占比。
func CostOverview(c *gin.Context) {
	startTs, endTs, ok := parseCostTimeRange(c, 30)
	if !ok {
		return
	}
	rows, err := model.GetCostDailyTrend(startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var revenue, cost, unknown int64
	var requests, unknownCount int64
	for _, row := range rows {
		revenue += row.RevenueQuota
		cost += row.CostQuota
		unknown += row.UnknownQuota
		requests += row.RequestCount
		unknownCount += row.UnknownCount
	}
	margin, pricedBase := pricedMargin(revenue, cost, unknown)
	overview := gin.H{
		"start_ts":             startTs,
		"end_ts":               endTs,
		"revenue_quota":        revenue,
		"cost_quota":           cost,
		"margin_quota":         margin,
		"margin_rate":          marginRateOrNull(pricedBase, margin),
		"priced_revenue_quota": pricedBase,
		"unknown_quota":        unknown,
		"unknown_rate":         requestCountRateOrNull(requests, unknownCount),
		"request_count":        requests,
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    overview,
	})
}

// marginRateOrNull 毛利率 = (revenue-cost)/revenue。分母为 0 返回 nil（免费
// 模型/纯赠额），前端渲染为 "—"，禁止除零。
func marginRateOrNull(revenue int64, margin int64) *float64 {
	if revenue <= 0 {
		return nil
	}
	rate := float64(margin) / float64(revenue)
	return &rate
}

// pricedMargin 按【已定价口径】算毛利，是本文件唯一允许的毛利算法。
//
// 未定价流量（cost_source=unknown）的收入照常累加进 revenue_quota，成本却被
// RecordCostSample（service/cost_flush.go:55-60）跳过，所以 revenue-cost 会把
// 这部分收入整笔当成纯利。一条渠道收入 400 成本 380、其中 200 未定价，全额口径
// 报 +5%，剔掉未定价后真实是 -90%——方向正好是最危险的那一侧（毛利虚高会让
// 亏损渠道看起来健康）。
//
// unknownRevenue 取 UnknownQuota：该字段存的是这些请求的【收入】而非成本，
// 名字容易误读。数据本来就在，不需要迁移，只是此前没有从分子分母里扣掉。
func pricedMargin(revenue, cost, unknownRevenue int64) (margin int64, base int64) {
	base = revenue - unknownRevenue
	if base < 0 {
		// 理论不可能（unknown 收入是 revenue 的子集），但宁可退化成 0 也不能
		// 让负分母算出一个反号的毛利率。
		base = 0
	}
	return base - cost, base
}

func requestCountRateOrNull(total int64, part int64) *float64 {
	if total <= 0 {
		return nil
	}
	rate := float64(part) / float64(total)
	return &rate
}

// CostTrend 按天分桶的趋势。
func CostTrend(c *gin.Context) {
	startTs, endTs, ok := parseCostTimeRange(c, 30)
	if !ok {
		return
	}
	rows, err := model.GetCostDailyTrend(startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
}

// CacheAllChannelsSnapshot 返回全部渠道的 (id -> name/balance) 快照，
// 库存对账用。关缓存部署回落 DB 全量查询。
func channelSnapshotForInventory() map[int]*model.Channel {
	channels, err := model.GetAllChannels(0, 0, true, false)
	if err != nil {
		return nil
	}
	result := make(map[int]*model.Channel, len(channels))
	for _, ch := range channels {
		result[ch.Id] = ch
	}
	return result
}

// CostChannels 按渠道明细。
func CostChannels(c *gin.Context) {
	startTs, endTs, ok := parseCostTimeRange(c, 30)
	if !ok {
		return
	}
	rows, err := model.GetCostDailyByChannel(startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	type channelCostRow struct {
		model.CostDailyAgg
		ChannelName string   `json:"channel_name"`
		MarginRate  *float64 `json:"margin_rate"`
	}
	result := make([]channelCostRow, 0, len(rows))
	channels := channelSnapshotForInventory()
	for _, row := range rows {
		out := channelCostRow{CostDailyAgg: row}
		if ch, okc := channels[row.ChannelId]; okc {
			out.ChannelName = ch.Name
		}
		rowMargin, rowBase := pricedMargin(row.RevenueQuota, row.CostQuota, row.UnknownQuota)
		out.MarginRate = marginRateOrNull(rowBase, rowMargin)
		result = append(result, out)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}

// CostModels 按模型明细。
func CostModels(c *gin.Context) {
	startTs, endTs, ok := parseCostTimeRange(c, 30)
	if !ok {
		return
	}
	rows, err := model.GetCostDailyRange(startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	type modelCostRow struct {
		model.CostDailyAgg
		MarginRate *float64 `json:"margin_rate"`
	}
	result := make([]modelCostRow, 0, len(rows))
	for _, row := range rows {
		out := modelCostRow{CostDailyAgg: row}
		rowMargin, rowBase := pricedMargin(row.RevenueQuota, row.CostQuota, row.UnknownQuota)
		out.MarginRate = marginRateOrNull(rowBase, rowMargin)
		result = append(result, out)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}

const (
	costChannelModelDefaultDays = 30
	// costChannelModelMaxDays 查询窗口上界。事实表是日汇总，窗口越宽扫的行
	// 越多；超界按调用错误拒绝而不是静默钳制——运营看到 366 天的表头却只
	// 拿到 30 天的数，比报错更危险。
	costChannelModelMaxDays = 366
)

// CostChannelModels 渠道×模型交叉毛利。/channels 吃掉模型维、/models 吃掉
// 渠道维，两者都回答不了"同一个模型在哪条线上进货更便宜"——而 fact 表的唯一
// 键本来就是 (day, channel, model)，三维数据一直都在，这里只是把 day 压掉、
// 保留另外两维。
//
// 与 /channels /models 的区别：那两个 handler 直接返回 GetCostDaily* 的原始
// 行（/models 其实连 day 都没压，同一模型会按天出多行），这里在 SQL 里
// GROUP BY channel_id, model_name 一次聚完，避免把几万行丢给前端再算。
func CostChannelModels(c *gin.Context) {
	days := costChannelModelDefaultDays
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			common.ApiErrorMsg(c, "invalid days")
			return
		}
		days = parsed
	}
	if days > costChannelModelMaxDays {
		common.ApiErrorMsg(c, fmt.Sprintf("days must not exceed %d", costChannelModelMaxDays))
		return
	}
	startTs, endTs, ok := parseCostTimeRange(c, days)
	if !ok {
		return
	}
	// 显式 start/end 会绕过 days，上界要在解析之后再兜一次。
	if (endTs-startTs)/86400 > int64(costChannelModelMaxDays) {
		common.ApiErrorMsg(c, fmt.Sprintf("time range must not exceed %d days", costChannelModelMaxDays))
		return
	}

	// 全部走参数化占位符：model 名是用户可控输入，任何拼接都是注入面。
	query := model.DB.Model(&model.ChannelCostDaily{}).
		Select("channel_id, model_name, 0 as day_ts, SUM(request_count) as request_count, SUM(token_used) as token_used, "+
			"SUM(revenue_quota) as revenue_quota, SUM(cost_quota) as cost_quota, "+
			"SUM(unknown_count) as unknown_count, SUM(unknown_quota) as unknown_quota, SUM(reported_quota) as reported_quota").
		Where("day_ts >= ? AND day_ts <= ?", startTs, endTs)
	if modelName := strings.TrimSpace(c.Query("model")); modelName != "" {
		query = query.Where("model_name = ?", modelName)
	}
	if raw := strings.TrimSpace(c.Query("channel_id")); raw != "" {
		channelId, err := strconv.Atoi(raw)
		if err != nil || channelId <= 0 {
			common.ApiErrorMsg(c, "invalid channel id")
			return
		}
		query = query.Where("channel_id = ?", channelId)
	}
	var rows []model.CostDailyAgg
	// ORDER BY 写成显式聚合而不是 SELECT 别名：三个库对"别名 vs 同名列"的
	// 解析规则不同，显式 SUM() 没有歧义。收入降序 + 复合键兜底保证稳定顺序。
	if err := query.Group("channel_id, model_name").
		Order("SUM(revenue_quota) DESC, channel_id ASC, model_name ASC").
		Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	type channelModelCostRow struct {
		model.CostDailyAgg
		ChannelName string   `json:"channel_name"`
		MarginQuota int64    `json:"margin_quota"`
		MarginRate  *float64 `json:"margin_rate"`
		UnknownRate *float64 `json:"unknown_rate"`
	}
	result := make([]channelModelCostRow, 0, len(rows))
	channels := channelSnapshotForInventory()
	for _, row := range rows {
		out := channelModelCostRow{CostDailyAgg: row}
		if ch, okc := channels[row.ChannelId]; okc {
			out.ChannelName = ch.Name
		} else {
			// 渠道已删但账还在。空字符串会让前端表格出现无主行，给个
			// 语言中立的可辨识占位（前端要本地化可按 "#<id>" 前缀识别）。
			out.ChannelName = fmt.Sprintf("#%d (deleted)", row.ChannelId)
		}
		rowMargin, rowBase := pricedMargin(row.RevenueQuota, row.CostQuota, row.UnknownQuota)
		out.MarginQuota = rowMargin
		out.MarginRate = marginRateOrNull(rowBase, rowMargin)
		// 未定价占比按请求数算，与 /overview 的 unknown_rate 同口径
		// （unknown_quota 记的是这些请求的收入，不是成本）。
		out.UnknownRate = requestCountRateOrNull(row.RequestCount, row.UnknownCount)
		result = append(result, out)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}

// CostChannelDetail 单渠道下钻（按模型）。
func CostChannelDetail(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelId <= 0 {
		common.ApiErrorMsg(c, "invalid channel id")
		return
	}
	startTs, endTs, ok := parseCostTimeRange(c, 30)
	if !ok {
		return
	}
	rows, err := model.GetCostDailyRange(startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	type modelCostRow struct {
		model.CostDailyAgg
		MarginRate *float64 `json:"margin_rate"`
	}
	result := make([]modelCostRow, 0)
	for _, row := range rows {
		if row.ChannelId != channelId {
			continue
		}
		out := modelCostRow{CostDailyAgg: row}
		rowMargin, rowBase := pricedMargin(row.RevenueQuota, row.CostQuota, row.UnknownQuota)
		out.MarginRate = marginRateOrNull(rowBase, rowMargin)
		result = append(result, out)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}

// CostPurchaseList 采购单列表。
func CostPurchaseList(c *gin.Context) {
	channelId, _ := strconv.Atoi(c.Query("channel_id"))
	startTs, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTs, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	purchases, total, err := model.GetChannelPurchases(channelId, startTs, endTs, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": purchases,
			"total": total,
		},
	})
}

// CostInventory 库存对账：抓取余额 vs 推算余额 + 差异。
func CostInventory(c *gin.Context) {
	purchases, err := model.GetPurchaseTotalsByChannel()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	costTotals, err := model.GetCostTotalByChannel()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	type inventoryRow struct {
		ChannelId      int      `json:"channel_id"`
		ChannelName    string   `json:"channel_name"`
		FetchedBalance float64  `json:"fetched_balance"` // 上游 API 抓取（真值，覆盖面有限）
		HasFetched     bool     `json:"has_fetched"`     // 渠道类型是否支持抓取
		PurchasedUSD   float64  `json:"purchased_usd"`   // 累计采购（含赠送）
		SpentUSD       float64  `json:"spent_usd"`       // 累计消耗成本
		DerivedBalance float64  `json:"derived_balance"` // 推算余额 = 采购 − 消耗
		DiffRate       *float64 `json:"diff_rate"`       // 差异率（两者都有才有）
	}
	channels := channelSnapshotForInventory()
	purchaseMap := make(map[int]model.PurchaseAgg, len(purchases))
	for _, p := range purchases {
		purchaseMap[p.ChannelId] = p
	}
	seen := make(map[int]bool)
	result := make([]inventoryRow, 0, len(channels))
	appendRow := func(channelId int, name string, balance float64, hasFetched bool) {
		if seen[channelId] {
			return
		}
		seen[channelId] = true
		p := purchaseMap[channelId]
		spentUSD := float64(costTotals[channelId]) / common.QuotaPerUnit
		purchased := p.TotalUSD + p.BonusUSD
		derived := purchased - spentUSD
		row := inventoryRow{
			ChannelId:      channelId,
			ChannelName:    name,
			FetchedBalance: balance,
			HasFetched:     hasFetched,
			PurchasedUSD:   purchased,
			SpentUSD:       spentUSD,
			DerivedBalance: derived,
		}
		if hasFetched && purchased > 0 {
			diff := (balance - derived) / purchased
			row.DiffRate = &diff
		}
		result = append(result, row)
	}
	for channelId, ch := range channels {
		balance := 0.0
		hasFetched := ch.BalanceUpdatedTime > 0 && ch.Balance > 0
		if hasFetched {
			balance = ch.Balance
		}
		appendRow(channelId, ch.Name, balance, hasFetched)
	}
	// 只有采购记录但没有渠道的（渠道已删）也列出，防漏账。
	for channelId := range purchaseMap {
		if !seen[channelId] {
			appendRow(channelId, "", 0, false)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}

// CostUpdateChannelPrice 保存渠道成本配置（RootAuth）。
func CostUpdateChannelPrice(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelId <= 0 {
		common.ApiErrorMsg(c, "invalid channel id")
		return
	}
	var costSettings dto.ChannelCostSettings
	if err := common.DecodeJson(c.Request.Body, &costSettings); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	if err := validateChannelCostSettings(&costSettings); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	channel, err := model.GetChannelById(channelId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	otherSettings := channel.GetOtherSettings()
	otherSettings.Cost = &costSettings
	channel.SetOtherSettings(otherSettings)
	if err := channel.Save(); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

// validateChannelCostSettings 校验成本配置：模式合法、单价有上界、比率在
// 合理区间。拒绝 NaN/Inf（成本单价虚高 = 毛利虚低 = 误触发告警）。
func validateChannelCostSettings(cs *dto.ChannelCostSettings) error {
	switch cs.Mode {
	case "", "ratio", "per_call", "expr":
	default:
		return fmt.Errorf("invalid cost mode: %s", cs.Mode)
	}
	if cs.DefaultMarkup != nil && (*cs.DefaultMarkup < 0 || *cs.DefaultMarkup > 100) {
		return fmt.Errorf("default_markup must be in [0, 100]")
	}
	if cs.Discount != nil && (*cs.Discount <= 0 || *cs.Discount > 1) {
		return fmt.Errorf("discount must be in (0, 1]")
	}
	const maxUnitPrice = 10000.0
	checkPtr := func(name string, v *float64) error {
		if v == nil {
			return nil
		}
		if *v < 0 || *v > maxUnitPrice {
			return fmt.Errorf("%s must be in [0, %g]", name, maxUnitPrice)
		}
		return nil
	}
	for model, price := range cs.Models {
		if strings.TrimSpace(model) == "" {
			return fmt.Errorf("empty model name in cost models")
		}
		checks := map[string]*float64{
			"input": price.Input, "output": price.Output,
			"cache_read": price.CacheRead, "cache_write_5m": price.CacheWrite5m,
			"cache_write_1h": price.CacheWrite1h, "audio_in": price.AudioIn,
			"audio_out": price.AudioOut, "image_in": price.ImageIn,
			"image_out": price.ImageOut, "reasoning": price.Reasoning,
			"per_call": price.PerCall,
		}
		for name, v := range checks {
			if err := checkPtr(name, v); err != nil {
				return fmt.Errorf("model %s: %w", model, err)
			}
		}
	}
	return nil
}

// CostBatchPrice 按 tag/type 批量设置成本（运营刚需，否则几十个渠道没人
// 愿意逐个配）。
func CostBatchPrice(c *gin.Context) {
	var req struct {
		Tag         string                   `json:"tag"`
		ChannelType int                      `json:"channel_type"`
		Cost        *dto.ChannelCostSettings `json:"cost"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Cost == nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	if err := validateChannelCostSettings(req.Cost); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if req.Tag == "" && req.ChannelType == 0 {
		common.ApiErrorMsg(c, "either tag or channel_type is required")
		return
	}
	channels, err := model.GetAllChannels(0, 0, true, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	updated := 0
	for i := range channels {
		ch := channels[i]
		if req.Tag != "" && (ch.Tag == nil || !strings.Contains(*ch.Tag, req.Tag)) {
			continue
		}
		if req.ChannelType != 0 && ch.Type != req.ChannelType {
			continue
		}
		otherSettings := ch.GetOtherSettings()
		costCopy := *req.Cost
		otherSettings.Cost = &costCopy
		ch.SetOtherSettings(otherSettings)
		if err := ch.Save(); err != nil {
			common.ApiError(c, err)
			return
		}
		updated++
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": fmt.Sprintf("updated %d channels", updated),
	})
}

// CostCreatePurchase 录入采购单（RootAuth）。
func CostCreatePurchase(c *gin.Context) {
	var purchase model.ChannelPurchase
	if err := common.DecodeJson(c.Request.Body, &purchase); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	if purchase.ChannelId <= 0 {
		common.ApiErrorMsg(c, "channel_id is required")
		return
	}
	if purchase.AmountUSD <= 0 {
		common.ApiErrorMsg(c, "amount_usd must be positive")
		return
	}
	if purchase.BonusUSD < 0 {
		purchase.BonusUSD = 0
	}
	if purchase.PurchasedAt <= 0 {
		purchase.PurchasedAt = time.Now().Unix()
	}
	purchase.CreatedAt = time.Now().Unix()
	purchase.OperatorId = c.GetInt("id")
	if err := model.CreateChannelPurchase(&purchase); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    purchase,
	})
}

// CostRecalculate 按时间范围从 logs 重算汇总（改了成本价后回溯）。依赖
// logs 还在（TTL/一键删除会清），UI 需提示可回溯范围。
func CostRecalculate(c *gin.Context) {
	var req struct {
		StartTs int64 `json:"start_timestamp"`
		EndTs   int64 `json:"end_timestamp"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	if req.StartTs <= 0 || req.EndTs <= 0 || req.EndTs < req.StartTs {
		common.ApiErrorMsg(c, "invalid time range")
		return
	}
	count, err := service.RecalculateCostDaily(req.StartTs, req.EndTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": fmt.Sprintf("recalculated %d log entries", count),
	})
}
