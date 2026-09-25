package model

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ChannelCostDaily 是渠道成本毛利的日汇总事实表（报表主力）。
// 全部落主库：LOG_DB 可以是 ClickHouse 且绕过 AutoMigrate，任何要 join
// channels 的报表，事实表必须在主库。
//
// 成本口径：cost_source=unknown 的请求记入 UnknownCount/UnknownQuota，
// 不参与毛利计算——"未定价流量占比"是这套账的健康度第一指标。
type ChannelCostDaily struct {
	Id            int    `json:"id" gorm:"primaryKey"`
	DayTs         int64  `json:"day_ts" gorm:"bigint;uniqueIndex:uk_ccd,priority:1;index:idx_ccd_ch_day,priority:2"`
	ChannelId     int    `json:"channel_id" gorm:"uniqueIndex:uk_ccd,priority:2;index:idx_ccd_ch_day,priority:1"`
	ModelName     string `json:"model_name" gorm:"type:varchar(128);uniqueIndex:uk_ccd,priority:3;default:''"`
	RequestCount  int    `json:"request_count" gorm:"default:0"`
	TokenUsed     int64  `json:"token_used" gorm:"bigint;default:0"`
	RevenueQuota  int64  `json:"revenue_quota" gorm:"bigint;default:0"`
	CostQuota     int64  `json:"cost_quota" gorm:"bigint;default:0"`
	UnknownCount  int    `json:"unknown_count" gorm:"default:0"`
	UnknownQuota  int64  `json:"unknown_quota" gorm:"bigint;default:0"`
	ReportedQuota int64  `json:"reported_quota" gorm:"bigint;default:0"`
}

func (ChannelCostDaily) TableName() string {
	return "channel_cost_daily"
}

// UpsertChannelCostDaily 累加 upsert。失败回填由调用方（flush 循环）负责，
// 这里只保证单行写入的幂等性：同一 (day, channel, model) 重复 flush 不重复
// 累加依赖 OnConflict 的 gorm.Expr 自增。
func UpsertChannelCostDaily(row *ChannelCostDaily) error {
	if row == nil {
		return nil
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "day_ts"},
			{Name: "channel_id"},
			{Name: "model_name"},
		},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"request_count":   gorm.Expr("channel_cost_daily.request_count + ?", row.RequestCount),
			"token_used":      gorm.Expr("channel_cost_daily.token_used + ?", row.TokenUsed),
			"revenue_quota":   gorm.Expr("channel_cost_daily.revenue_quota + ?", row.RevenueQuota),
			"cost_quota":      gorm.Expr("channel_cost_daily.cost_quota + ?", row.CostQuota),
			"unknown_count":   gorm.Expr("channel_cost_daily.unknown_count + ?", row.UnknownCount),
			"unknown_quota":   gorm.Expr("channel_cost_daily.unknown_quota + ?", row.UnknownQuota),
			"reported_quota":  gorm.Expr("channel_cost_daily.reported_quota + ?", row.ReportedQuota),
		}),
	}).Create(row).Error
}

// CostDailyAgg 是聚合查询的投影。
type CostDailyAgg struct {
	ChannelId     int    `json:"channel_id"`
	ModelName     string `json:"model_name"`
	DayTs         int64  `json:"day_ts"`
	RequestCount  int64  `json:"request_count"`
	TokenUsed     int64  `json:"token_used"`
	RevenueQuota  int64  `json:"revenue_quota"`
	CostQuota     int64  `json:"cost_quota"`
	UnknownCount  int64  `json:"unknown_count"`
	UnknownQuota  int64  `json:"unknown_quota"`
	ReportedQuota int64  `json:"reported_quota"`
}

// GetCostDailyRange 按时间范围取全部明细行（按渠道/模型分组由调用方做）。
func GetCostDailyRange(startTs, endTs int64) ([]CostDailyAgg, error) {
	var rows []CostDailyAgg
	err := DB.Model(&ChannelCostDaily{}).
		Select("channel_id, model_name, day_ts, SUM(request_count) as request_count, SUM(token_used) as token_used, "+
			"SUM(revenue_quota) as revenue_quota, SUM(cost_quota) as cost_quota, "+
			"SUM(unknown_count) as unknown_count, SUM(unknown_quota) as unknown_quota, SUM(reported_quota) as reported_quota").
		Where("day_ts >= ? AND day_ts <= ?", startTs, endTs).
		Group("channel_id, model_name, day_ts").
		Find(&rows).Error
	return rows, err
}

// GetCostDailyByChannel 按渠道聚合时间范围内的行。
func GetCostDailyByChannel(startTs, endTs int64) ([]CostDailyAgg, error) {
	var rows []CostDailyAgg
	err := DB.Model(&ChannelCostDaily{}).
		Select("channel_id, '' as model_name, 0 as day_ts, SUM(request_count) as request_count, SUM(token_used) as token_used, "+
			"SUM(revenue_quota) as revenue_quota, SUM(cost_quota) as cost_quota, "+
			"SUM(unknown_count) as unknown_count, SUM(unknown_quota) as unknown_quota, SUM(reported_quota) as reported_quota").
		Where("day_ts >= ? AND day_ts <= ?", startTs, endTs).
		Group("channel_id").
		Find(&rows).Error
	return rows, err
}

// GetCostDailyByChannelList 批量取指定渠道在时间范围内的聚合（渠道列表页
// 的成本/毛利三列用，一次查询避免 N+1）。
func GetCostDailyByChannelList(channelIds []int, startTs, endTs int64) (map[int]CostDailyAgg, error) {
	result := make(map[int]CostDailyAgg, len(channelIds))
	if len(channelIds) == 0 {
		return result, nil
	}
	var rows []CostDailyAgg
	err := DB.Model(&ChannelCostDaily{}).
		Select("channel_id, '' as model_name, 0 as day_ts, SUM(request_count) as request_count, SUM(token_used) as token_used, "+
			"SUM(revenue_quota) as revenue_quota, SUM(cost_quota) as cost_quota, "+
			"SUM(unknown_count) as unknown_count, SUM(unknown_quota) as unknown_quota, SUM(reported_quota) as reported_quota").
		Where("day_ts >= ? AND day_ts <= ? AND channel_id IN ?", startTs, endTs, channelIds).
		Group("channel_id").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ChannelId] = row
	}
	return result, nil
}

// GetCostDailyTrend 按天聚合全部渠道的时间序列。
func GetCostDailyTrend(startTs, endTs int64) ([]CostDailyAgg, error) {
	var rows []CostDailyAgg
	err := DB.Model(&ChannelCostDaily{}).
		Select("0 as channel_id, '' as model_name, day_ts, SUM(request_count) as request_count, SUM(token_used) as token_used, "+
			"SUM(revenue_quota) as revenue_quota, SUM(cost_quota) as cost_quota, "+
			"SUM(unknown_count) as unknown_count, SUM(unknown_quota) as unknown_quota, SUM(reported_quota) as reported_quota").
		Where("day_ts >= ? AND day_ts <= ?", startTs, endTs).
		Group("day_ts").
		Order("day_ts ASC").
		Find(&rows).Error
	return rows, err
}

// DeleteCostDailyRange 删除时间范围内的汇总行（recalculate 回溯重算用）。
func DeleteCostDailyRange(startTs, endTs int64) error {
	return DB.Where("day_ts >= ? AND day_ts <= ?", startTs, endTs).
		Delete(&ChannelCostDaily{}).Error
}

// GetLogsForCostRecalc 分批读取时间范围内的 consume 日志（重算汇总用）。
// 只查 type=2（消费）且 channel>0 的行。
func GetLogsForCostRecalc(startTs, endTs int64, offset, limit int) ([]*Log, int64, error) {
	var logs []*Log
	err := LOG_DB.Model(&Log{}).
		// channel_id, not channel: the column is named after the struct field, and
		// `channel > 0` is not a filter that matches nothing — it is a SQL error
		// ("no such column"), which failed every RecalculateCostDaily run.
		Where("created_at >= ? AND created_at <= ? AND type = ? AND channel_id > 0",
			startTs, endTs, LogTypeConsume).
		Order("id ASC").
		Offset(offset).Limit(limit).
		Find(&logs).Error
	return logs, int64(len(logs)), err
}

// ChannelPurchase 是向上游充值的采购单（进销存的"进货"账）。
// BonusUSD 必须单独记：充 $100 送 $20，实际单位成本是 100/120 = 0.833，
// 不记赠送额度会把成本高估 20%。
type ChannelPurchase struct {
	Id           int     `json:"id" gorm:"primaryKey"`
	ChannelId    int     `json:"channel_id" gorm:"index:idx_cp_ch_time,priority:1"`
	PurchasedAt  int64   `json:"purchased_at" gorm:"bigint;index:idx_cp_ch_time,priority:2"`
	AmountUSD    float64 `json:"amount_usd"`
	AmountLocal  float64 `json:"amount_local"`
	ExchangeRate float64 `json:"exchange_rate"`
	BonusUSD     float64 `json:"bonus_usd"`
	Vendor       string  `json:"vendor" gorm:"type:varchar(128);default:''"`
	OrderNo      string  `json:"order_no" gorm:"type:varchar(128);index;default:''"`
	Note         string  `json:"note" gorm:"type:varchar(512);default:''"`
	OperatorId   int     `json:"operator_id"`
	CreatedAt    int64   `json:"created_at" gorm:"bigint"`
}

func (ChannelPurchase) TableName() string {
	return "channel_purchase"
}

func CreateChannelPurchase(purchase *ChannelPurchase) error {
	return DB.Create(purchase).Error
}

func GetChannelPurchases(channelId int, startTs, endTs int64, page, pageSize int) ([]ChannelPurchase, int64, error) {
	var purchases []ChannelPurchase
	var total int64
	query := DB.Model(&ChannelPurchase{})
	if channelId > 0 {
		query = query.Where("channel_id = ?", channelId)
	}
	if startTs > 0 {
		query = query.Where("purchased_at >= ?", startTs)
	}
	if endTs > 0 {
		query = query.Where("purchased_at <= ?", endTs)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	if page <= 0 {
		page = 1
	}
	err := query.Order("purchased_at DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&purchases).Error
	return purchases, total, err
}

// PurchaseAgg 是渠道维度的采购汇总（库存对账用）。
type PurchaseAgg struct {
	ChannelId int     `json:"channel_id"`
	TotalUSD  float64 `json:"total_usd"`
	BonusUSD  float64 `json:"bonus_usd"`
}

// GetPurchaseTotalsByChannel 汇总每渠道累计采购（含赠送）。
func GetPurchaseTotalsByChannel() ([]PurchaseAgg, error) {
	var rows []PurchaseAgg
	err := DB.Model(&ChannelPurchase{}).
		Select("channel_id, SUM(amount_usd) as total_usd, SUM(bonus_usd) as bonus_usd").
		Group("channel_id").
		Find(&rows).Error
	return rows, err
}

// GetCostTotalByChannel 汇总每渠道累计成本（推算余额 = 采购 − 累计成本）。
func GetCostTotalByChannel() (map[int]int64, error) {
	var rows []struct {
		ChannelId int   `json:"channel_id"`
		CostQuota int64 `json:"cost_quota"`
	}
	err := DB.Model(&ChannelCostDaily{}).
		Select("channel_id, SUM(cost_quota) as cost_quota").
		Group("channel_id").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int]int64, len(rows))
	for _, row := range rows {
		result[row.ChannelId] = row.CostQuota
	}
	return result, nil
}
