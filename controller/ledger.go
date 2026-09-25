package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 交易账本接口。全部走 AdminAuth：每一行都带上游进价和这笔赚了多少，这是客户绝不
// 能从自己的用量里读到的东西。

// maxLedgerBackfillLimit 限制单次回填的扫描量。回填是逐行 UPDATE，不设上限会让一次
// 请求把日志库压住；分多次跑是幂等的（只改 cost_source 为空的行）。
const maxLedgerBackfillLimit = 50000

// parseLedgerQuery 从查询串读账本条件。
//
// 排序列走白名单枚举，不接受任意字符串：排序列会拼进 ORDER BY，直接收 URL 里的值
// 就是 SQL 注入。不认识的值退化成按时间倒序，而不是报错——书签里的旧参数不该让页面
// 打不开。
func parseLedgerQuery(c *gin.Context) model.LedgerQuery {
	pageInfo := common.GetPageQuery(c)
	channelId, _ := strconv.Atoi(c.Query("channel"))

	sortBy := model.LedgerSortTime
	switch c.Query("sort_by") {
	case "profit":
		sortBy = model.LedgerSortProfit
	case "cost":
		sortBy = model.LedgerSortCost
	case "revenue":
		sortBy = model.LedgerSortRevenue
	}

	marginFilter := model.LedgerMarginAll
	switch c.Query("margin") {
	case model.LedgerMarginProfitable:
		marginFilter = model.LedgerMarginProfitable
	case model.LedgerMarginLoss:
		marginFilter = model.LedgerMarginLoss
	case model.LedgerMarginUnpriced:
		marginFilter = model.LedgerMarginUnpriced
	}

	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)

	return model.LedgerQuery{
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
		Username:       c.Query("username"),
		ModelName:      c.Query("model_name"),
		ChannelId:      channelId,
		Group:          c.Query("group"),
		LineCode:       c.Query("line_code"),
		MarginFilter:   marginFilter,
		SortBy:         sortBy,
		SortAsc:        c.Query("order") == "asc",
		StartIdx:       pageInfo.GetStartIdx(),
		Num:            pageInfo.GetPageSize(),
	}
}

// LedgerList 返回一页交易记录。
func LedgerList(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	logs, total, err := model.GetLedgerLogs(parseLedgerQuery(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

// LedgerSummary 返回整个筛选范围的毛利汇总。
//
// 与列表分开是必要的，不是多此一举：列表是分页的，把当页合计当成整段合计是这类报表
// 最常见的误读。汇总由数据库 SUM 出来，口径与列表的筛选条件完全一致。
func LedgerSummary(c *gin.Context) {
	summary, err := model.GetLedgerSummary(parseLedgerQuery(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 毛利率的分母只能是"定过价的那部分收入"。拿全部收入做分母会把未定价流量按
	// 零成本摊进去，毛利率虚高——而未定价占比恰恰是这套账要盯的第一个指标。
	var marginRate *float64
	if summary.PricedRevenue > 0 {
		rate := float64(summary.MarginQuota) / float64(summary.PricedRevenue)
		marginRate = &rate
	}
	var unpricedRate *float64
	if summary.RequestCount > 0 {
		rate := float64(summary.RequestCount-summary.PricedCount) / float64(summary.RequestCount)
		unpricedRate = &rate
	}

	common.ApiSuccess(c, gin.H{
		"request_count":         summary.RequestCount,
		"priced_count":          summary.PricedCount,
		"revenue_quota":         summary.RevenueQuota,
		"priced_revenue_quota":  summary.PricedRevenue,
		"cost_quota":            summary.CostQuota,
		"margin_quota":          summary.MarginQuota,
		"unknown_revenue_quota": summary.UnknownRevenue,
		"margin_rate":           marginRate,
		"unpriced_rate":         unpricedRate,
	})
}

// LedgerBackfill 把历史日志的成本快照回填进毛利列。
//
// RootAuth：它改写历史账目行。幂等（只动 cost_source 为空的行），所以可以分多次跑
// 完一段长历史。
func LedgerBackfill(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > maxLedgerBackfillLimit {
		limit = maxLedgerBackfillLimit
	}

	result, err := model.BackfillMarginColumns(startTimestamp, endTimestamp, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
