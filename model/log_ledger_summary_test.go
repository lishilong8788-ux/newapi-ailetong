package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 账本汇总的口径：定过价的行进成本/毛利，未定价的行只进收入。
//
// 这里同时守住一条低级但致命的回归：汇总的 SELECT 是拼出来的，一旦占位符数量和
// 绑定参数数量对不上，GORM 会把参数当成额外的查询列拼进 SELECT，SQL 直接报
// "no such column"，整个汇总条接口 500。
func TestGetLedgerSummaryCostGrades(t *testing.T) {
	require.NoError(t, LOG_DB.Where("1 = 1").Delete(&Log{}).Error)

	rows := []*Log{
		// 定过价：收入 100，成本 60，毛利 40。
		{Type: LogTypeConsume, Username: "alice", ModelName: "gpt-x", CreatedAt: 1000,
			Quota: 100, CostQuota: 60, MarginQuota: 40, CostSource: "channel"},
		// 定过价且亏损：收入 10，成本 30，毛利 -20。
		{Type: LogTypeConsume, Username: "bob", ModelName: "gpt-x", CreatedAt: 1001,
			Quota: 10, CostQuota: 30, MarginQuota: -20, CostSource: "channel"},
		// 未定价（cost_source=unknown）：只能进收入，不能按零成本算 100% 毛利。
		{Type: LogTypeConsume, Username: "carol", ModelName: "gpt-x", CreatedAt: 1002,
			Quota: 7, CostSource: costSourceUnknown},
		// 未定价（历史行，cost_source 为空）：同上。
		{Type: LogTypeConsume, Username: "dave", ModelName: "gpt-x", CreatedAt: 1003,
			Quota: 3},
		// 运营流量：不属于客户销售，任何口径都不能算进来。
		{Type: LogTypeConsume, Username: "root", ModelName: "gpt-x", CreatedAt: 1004,
			Quota: 500, CostQuota: 100, MarginQuota: 400, CostSource: "channel",
			TrafficSource: "playground"},
		// 非消费日志：账本只回答"卖了多少"。
		{Type: LogTypeTopup, Username: "alice", CreatedAt: 1005, Quota: 9999},
	}
	for _, row := range rows {
		require.NoError(t, LOG_DB.Create(row).Error)
	}

	summary, err := GetLedgerSummary(LedgerQuery{StartTimestamp: 900, EndTimestamp: 2000})
	require.NoError(t, err)

	assert.Equal(t, int64(4), summary.RequestCount)
	assert.Equal(t, int64(2), summary.PricedCount)
	assert.Equal(t, int64(120), summary.RevenueQuota)
	assert.Equal(t, int64(110), summary.PricedRevenue)
	assert.Equal(t, int64(90), summary.CostQuota)
	assert.Equal(t, int64(20), summary.MarginQuota)
	assert.Equal(t, int64(10), summary.UnknownRevenue)
	// 毛利必须是收入减成本，否则前端算出来的毛利率和三个总数对不上。
	assert.Equal(t, summary.PricedRevenue-summary.CostQuota, summary.MarginQuota)

	// 毛利筛选与汇总共用同一个"定过价"判据，一起守住：未定价的行既不能落进
	// 盈利也不能落进亏损，否则"未定价占比"这个指标就没有意义了。
	for _, tc := range []struct {
		filter string
		users  []string
	}{
		{LedgerMarginProfitable, []string{"alice"}},
		{LedgerMarginLoss, []string{"bob"}},
		{LedgerMarginUnpriced, []string{"carol", "dave"}},
		{LedgerMarginAll, []string{"alice", "bob", "carol", "dave"}},
	} {
		logs, total, err := GetLedgerLogs(LedgerQuery{
			StartTimestamp: 900,
			EndTimestamp:   2000,
			MarginFilter:   tc.filter,
			Num:            10,
		})
		require.NoError(t, err, tc.filter)
		assert.Equal(t, int64(len(tc.users)), total, tc.filter)

		got := make([]string, 0, len(logs))
		for _, log := range logs {
			got = append(got, log.Username)
		}
		assert.ElementsMatch(t, tc.users, got, tc.filter)
	}
}
