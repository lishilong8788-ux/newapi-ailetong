package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"

	"gorm.io/gorm"
)

// 交易账本查询。与 GetAllLogs 分开，不是为了省参数：账本要按毛利排序、按"亏损/
// 未定价"过滤，这两件事只有 cost_quota / cost_source 这两列在才做得到，而 GetAllLogs
// 的调用方（普通日志页）不需要它们，也不该被这些条件影响分页计数。

// LedgerMarginFilter 是毛利维度的过滤口径。
const (
	// LedgerMarginAll 不过滤。
	LedgerMarginAll = ""
	// LedgerMarginProfitable 只看赚钱的：定了价且毛利为正。
	LedgerMarginProfitable = "profitable"
	// LedgerMarginLoss 只看亏钱的：定了价且毛利为负。严格小于 0——毛利恰好为 0
	// 不是亏损，把它算进来会让"哪些单在亏"这个问题被免费模型的 0 稀释掉。
	LedgerMarginLoss = "loss"
	// LedgerMarginUnpriced 只看没定价的：成本未知，既不算赚也不算亏。
	LedgerMarginUnpriced = "unpriced"
)

// LedgerSort 是账本支持的排序列。白名单枚举而不是收字符串拼进 ORDER BY——
// 排序列来自 URL，拼接就是 SQL 注入。
const (
	LedgerSortTime    = ""
	LedgerSortProfit  = "profit"
	LedgerSortCost    = "cost"
	LedgerSortRevenue = "revenue"
)

// LedgerQuery 是一次账本查询的全部条件。
type LedgerQuery struct {
	StartTimestamp int64
	EndTimestamp   int64
	Username       string
	ModelName      string
	ChannelId      int
	Group          string
	LineCode       string
	MarginFilter   string
	SortBy         string
	// SortAsc 仅对毛利/成本/收入排序有意义；时间排序恒为倒序（最新在前）。
	SortAsc  bool
	StartIdx int
	Num      int
}

// pricedCostCondition 是"这笔的成本是真数"的判据。
//
// cost_source 非空且不是 unknown 才算定过价。不能只看 cost_quota != 0：未定价的
// 行成本列就是 0，把它当成本会报出 100% 毛利——这正是这套账最危险的静默错误。
//
// 常量直接拼进 SQL，不走 ? 占位符：这个片段要被 SELECT 里的多个 CASE WHEN 复用，
// 而 gorm 的 Select(query, args...) 只在"占位符数 >= 参数数"时才按表达式绑定，否则
// 会把参数当成额外的查询列（SELECT ..., unknown）并让剩下的 ? 去吃 WHERE 的参数，
// 整条 SQL 的绑定全部错位。值是本包的 Go 常量，不是外部输入，没有注入面。
func pricedCostCondition() string {
	return "logs.cost_source <> '' AND logs.cost_source <> '" + costSourceUnknown + "'"
}

// applyLedgerScope 是每个账本查询都要先套上的范围：只看真实客户流量。
//
// 我们自己打的流量（渠道测试、playground、运营副驾）花的是真成本、收的是自己的钱。
// 把它们算进毛利会报出一笔不存在的亏损。日聚合表那边早就这么过滤了
// （parseLogForCostRecalc），账本必须同口径，否则两张报表对不上账——名单共用
// OpsTrafficSources，就是为了不再出现「加了新来源只改一处」。
//
// 空字符串算客户流量：traffic_source 列是后加的，历史行没有值，而历史行绝大多数
// 是真实 API 流量——把它们当运营流量排掉会让账本突然少掉一大段历史。
func applyLedgerScope(tx *gorm.DB, query LedgerQuery) (*gorm.DB, error) {
	tx = tx.Where("logs.type = ?", LogTypeConsume).
		Where("logs.traffic_source NOT IN ?", OpsTrafficSources)

	var err error
	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", query.ModelName); err != nil {
		return nil, err
	}
	if tx, err = applyExplicitLogTextFilter(tx, "logs.username", query.Username); err != nil {
		return nil, err
	}
	if query.StartTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", query.StartTimestamp)
	}
	if query.EndTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", query.EndTimestamp)
	}
	if query.ChannelId != 0 {
		tx = tx.Where("logs.channel_id = ?", query.ChannelId)
	}
	if query.Group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", query.Group)
	}
	if query.LineCode != "" {
		tx = tx.Where("logs.line_code = ?", query.LineCode)
	}
	return applyLedgerMarginFilter(tx, query.MarginFilter), nil
}

func applyLedgerMarginFilter(tx *gorm.DB, filter string) *gorm.DB {
	switch filter {
	case LedgerMarginProfitable:
		return tx.Where(pricedCostCondition() + " AND logs.margin_quota > 0")
	case LedgerMarginLoss:
		return tx.Where(pricedCostCondition() + " AND logs.margin_quota < 0")
	case LedgerMarginUnpriced:
		return tx.Where("logs.cost_source = '' OR logs.cost_source = ?", costSourceUnknown)
	default:
		return tx
	}
}

// ledgerOrderClause 把排序枚举翻成 ORDER BY。
//
// 每个排序都以 (created_at, id) 收尾，保证分页稳定：毛利相同的行在两页之间的相对
// 顺序必须固定，否则翻页会重复或漏掉行。ClickHouse 上用 request_id 兜底，它的 id
// 是展示用的序号，不是真主键。
func ledgerOrderClause(sortBy string, asc bool) string {
	tail := "logs.created_at desc, logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		tail = clickHouseLogOrder("logs.")
	}

	direction := "desc"
	if asc {
		direction = "asc"
	}

	switch sortBy {
	case LedgerSortProfit:
		// 未定价的行排在最后（两个方向都是）：它们的成本未知，当成 0 参与排名会让
		// "亏得最多"的第一页全是没定价的单，真正的亏损被挤到后面去。
		return fmt.Sprintf("logs.cost_source = '' %s, logs.margin_quota %s, %s",
			pricedLastDirection(), direction, tail)
	case LedgerSortCost:
		return fmt.Sprintf("logs.cost_source = '' %s, logs.cost_quota %s, %s",
			pricedLastDirection(), direction, tail)
	case LedgerSortRevenue:
		return fmt.Sprintf("logs.quota %s, %s", direction, tail)
	default:
		return tail
	}
}

// pricedLastDirection 让"未定价"这个布尔表达式把未定价的行推到最后。
//
// 各数据库对布尔表达式的排序值取法一致（false < true），所以 asc 就是"有值的在前"。
func pricedLastDirection() string {
	return "asc"
}

// GetLedgerLogs 查一页交易记录。
//
// 只查消费日志：账本回答"卖了多少、成本多少、赚了多少"，充值/管理/登录日志既没有
// 成本快照也没有上游渠道。退款也排除——它是对先前某笔的反向流水，不是自己的一笔
// 销售，混进来会让每页的毛利合计对不上。
func GetLedgerLogs(query LedgerQuery) (logs []*Log, total int64, err error) {
	tx, err := applyLedgerScope(LOG_DB, query)
	if err != nil {
		return nil, 0, err
	}

	if err = tx.Model(&Log{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err = tx.Order(ledgerOrderClause(query.SortBy, query.SortAsc)).
		Limit(query.Num).Offset(query.StartIdx).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		assignDisplayLogIds(logs, query.StartIdx)
	}
	attachLogChannelIdentity(logs)
	return logs, total, nil
}

// LedgerSummary 是一个时间窗内的毛利汇总，由数据库算，不是前端加的。
//
// 成本与毛利只统计定过价的行；未定价的行单独出计数和收入，"未定价流量占比"是这套
// 账的健康度第一指标，不能被平均进毛利率里。
type LedgerSummary struct {
	RequestCount   int64 `json:"request_count"`
	PricedCount    int64 `json:"priced_count"`
	RevenueQuota   int64 `json:"revenue_quota"`
	PricedRevenue  int64 `json:"priced_revenue_quota"`
	CostQuota      int64 `json:"cost_quota"`
	MarginQuota    int64 `json:"margin_quota"`
	UnknownRevenue int64 `json:"unknown_revenue_quota"`
}

// GetLedgerSummary 汇总整个筛选范围（不是当前页）。
//
// 分页的合计只能回答"这一页赚了多少"，运营要的是"这一段时间赚了多少"。用 SUM 走
// 数据库，避免把一页的数字当成整段的数字。
func GetLedgerSummary(query LedgerQuery) (*LedgerSummary, error) {
	tx, err := applyLedgerScope(LOG_DB.Model(&Log{}), query)
	if err != nil {
		return nil, err
	}

	// CASE WHEN 而不是两次查询：一次扫描出全部口径，且"定价行的收入"必须与成本
	// 来自同一次扫描，否则两个数字可能横跨一次写入，毛利率会对不上。
	priced := fmt.Sprintf("CASE WHEN %s THEN 1 ELSE 0 END", pricedCostCondition())
	summary := &LedgerSummary{}
	err = tx.Select(
		"COUNT(*) as request_count, " +
			"COALESCE(SUM(" + priced + "), 0) as priced_count, " +
			"COALESCE(SUM(logs.quota), 0) as revenue_quota, " +
			"COALESCE(SUM(CASE WHEN " + pricedCostCondition() + " THEN logs.quota ELSE 0 END), 0) as priced_revenue, " +
			"COALESCE(SUM(logs.cost_quota), 0) as cost_quota, " +
			"COALESCE(SUM(logs.margin_quota), 0) as margin_quota, " +
			"COALESCE(SUM(CASE WHEN " + pricedCostCondition() + " THEN 0 ELSE logs.quota END), 0) as unknown_revenue",
	).Scan(summary).Error
	if err != nil {
		return nil, err
	}
	return summary, nil
}

// attachLogChannelIdentity 回填渠道名与渠道类型（厂商）。
//
// 从 GetAllLogs 里提出来共用：两个列表都要"这笔是哪个渠道、哪个厂商做的"，而这段
// 逻辑有内存缓存与批量查询两条分支，抄一份必然漂移。
func attachLogChannelIdentity(logs []*Log) {
	channelIds := types.NewSet[int]()
	for _, log := range logs {
		if log.ChannelId != 0 {
			channelIds.Add(log.ChannelId)
		}
	}
	if channelIds.Len() == 0 {
		return
	}

	type channelRow struct {
		Id   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
		Type int    `gorm:"column:type"`
	}
	var channels []channelRow
	if common.MemoryCacheEnabled {
		for _, channelId := range channelIds.Items() {
			if cacheChannel, err := CacheGetChannel(channelId); err == nil {
				channels = append(channels, channelRow{
					Id:   channelId,
					Name: cacheChannel.Name,
					Type: cacheChannel.Type,
				})
			}
		}
	} else if err := DB.Table("channels").Select("id, name, type").
		Where("id IN ?", channelIds.Items()).Find(&channels).Error; err != nil {
		// 渠道查不到不影响日志本身可读：名字留空，别把整页查询失败掉。
		common.SysError("failed to resolve channel identity for logs: " + err.Error())
		return
	}

	type channelIdentity struct {
		Name string
		Type int
	}
	channelMap := make(map[int]channelIdentity, len(channels))
	for _, channel := range channels {
		channelMap[channel.Id] = channelIdentity{Name: channel.Name, Type: channel.Type}
	}
	for i := range logs {
		identity := channelMap[logs[i].ChannelId]
		logs[i].ChannelName = identity.Name
		logs[i].ChannelType = identity.Type
	}
}
