package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
)

// 毛利列的历史回填。这些列是后加的，早于它们的日志里成本只存在 other 的 JSON 快照
// 里——不回填的话，账本按利润排序会只看到新数据，看起来像"历史全是未定价"。
//
// 幂等：只改 cost_source 为空的行。重跑一次不会把已回填的行再动一遍，也不会覆盖
// 结算时写进去的真值。

// BackfillMarginColumnsResult 是一次回填的结果，用于回给管理员。
type BackfillMarginColumnsResult struct {
	Scanned int `json:"scanned"`
	Updated int `json:"updated"`
}

// BackfillMarginColumns 把 other.admin_info 里的成本快照回填进毛利列。
//
// 逐批扫描而不是一条 UPDATE ... SELECT：成本藏在 JSON 文本里，三种数据库的 JSON
// 函数各不相同（SQLite 的 json_extract、MySQL 的 ->>、PostgreSQL 的 jsonb 操作符），
// 而 ClickHouse 日志库根本不走 AutoMigrate。在 Go 里解析是唯一对三库都成立的写法。
//
// ClickHouse 不支持按行 UPDATE（它的 ALTER TABLE UPDATE 是异步 mutation），所以那边
// 直接跳过：ClickHouse 部署的历史行保持未定价，新写入的行带列，这是可接受的降级。
func BackfillMarginColumns(startTs, endTs int64, limit int) (*BackfillMarginColumnsResult, error) {
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		return nil, fmt.Errorf("backfill is not supported on ClickHouse log storage: per-row UPDATE is an async mutation there, so new rows carry the columns but history stays unpriced")
	}

	const batchSize = 500
	result := &BackfillMarginColumnsResult{}
	// 以 id 为游标而不是 OFFSET：回填会改动被扫过的行，用 OFFSET 翻页会在结果集
	// 缩小时跳过行。
	lastId := 0

	for {
		if limit > 0 && result.Scanned >= limit {
			break
		}
		take := batchSize
		if limit > 0 && limit-result.Scanned < take {
			take = limit - result.Scanned
		}

		var logs []*Log
		tx := LOG_DB.Model(&Log{}).
			Where("logs.id > ? AND logs.type = ? AND logs.cost_source = ''", lastId, LogTypeConsume)
		if startTs != 0 {
			tx = tx.Where("logs.created_at >= ?", startTs)
		}
		if endTs != 0 {
			tx = tx.Where("logs.created_at <= ?", endTs)
		}
		if err := tx.Order("logs.id asc").Limit(take).Find(&logs).Error; err != nil {
			return result, err
		}
		if len(logs) == 0 {
			break
		}

		for _, log := range logs {
			result.Scanned++
			lastId = log.Id
			if log.Other == "" {
				continue
			}
			var other map[string]interface{}
			if err := common.UnmarshalJsonStr(log.Other, &other); err != nil {
				// 坏 JSON 跳过而不是中断：一行存坏了不该挡住整段历史的回填。
				continue
			}

			// 复用写入路径的同一个函数，口径不会漂：row_scoped 的判断、unknown 不计
			// 成本、margin = quota - cost 这三条规则只有一份实现。
			staged := &Log{Quota: log.Quota}
			applyMarginColumns(staged, other)
			if staged.CostSource == "" && staged.TrafficSource == "" && staged.LineCode == "" {
				continue
			}

			updates := map[string]interface{}{
				"cost_quota":     staged.CostQuota,
				"cost_source":    staged.CostSource,
				"margin_quota":   staged.MarginQuota,
				"line_code":      staged.LineCode,
				"traffic_source": staged.TrafficSource,
			}
			if err := LOG_DB.Model(&Log{}).Where("id = ?", log.Id).Updates(updates).Error; err != nil {
				return result, err
			}
			result.Updated++
		}

		if len(logs) < take {
			break
		}
	}

	return result, nil
}
