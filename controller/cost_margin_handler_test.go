package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/model"
)

// Exercises the real handlers against real ChannelCostDaily rows. The unit test
// on pricedMargin proves the arithmetic; this proves the arithmetic is the one
// the HTTP surface actually serves, which is what an operator reads.
func newCostTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	oldDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.ChannelCostDaily{}))
	model.DB = db
	t.Cleanup(func() {
		model.DB = oldDB
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func seedCostDaily(t *testing.T, db *gorm.DB, rows ...model.ChannelCostDaily) {
	t.Helper()
	day := time.Now().Unix() / 86400 * 86400
	for i := range rows {
		if rows[i].DayTs == 0 {
			rows[i].DayTs = day
		}
		require.NoError(t, db.Create(&rows[i]).Error)
	}
}

func callCostHandler(t *testing.T, h gin.HandlerFunc, target string) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	h(c)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	var envelope map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
	require.True(t, envelope["success"].(bool), "message: %v", envelope["message"])
	return envelope
}

// The regression in full: a channel billing 400 with 380 of upstream cost, where
// half the revenue could not be priced. The old basis reported a healthy +5%
// because unpriced revenue carried no cost to subtract. Serving that number lets
// a channel losing 90% on every priced request look like the good one.
func TestCostOverviewHandler_ExcludesUnpricedRevenueFromMargin(t *testing.T) {
	db := newCostTestDB(t)
	seedCostDaily(t, db, model.ChannelCostDaily{
		ChannelId:    2,
		ModelName:    "gpt-5",
		RequestCount: 10,
		RevenueQuota: 400,
		CostQuota:    380,
		UnknownCount: 5,
		UnknownQuota: 200,
	})

	data := callCostHandler(t, CostOverview, "/api/cost/overview?days=30")["data"].(map[string]any)

	require.Equal(t, float64(400), data["revenue_quota"], "total revenue must still report in full")
	require.Equal(t, float64(200), data["priced_revenue_quota"])
	require.Equal(t, float64(-180), data["margin_quota"], "200 priced revenue - 380 cost")

	rate := data["margin_rate"]
	require.NotNil(t, rate)
	require.InDelta(t, -0.9, rate.(float64), 1e-9,
		"the old full-revenue basis would have served +0.05 here")
}

// A row whose traffic is entirely unpriced has no basis to measure. nil renders
// as a dash; 0 would read as break-even, which is a claim the data cannot make.
func TestCostChannelModelsHandler_FullyUnpricedRowHasNoRate(t *testing.T) {
	db := newCostTestDB(t)
	seedCostDaily(t, db, model.ChannelCostDaily{
		ChannelId:    3,
		ModelName:    "free-model",
		RequestCount: 4,
		RevenueQuota: 500,
		CostQuota:    0,
		UnknownCount: 4,
		UnknownQuota: 500,
	})

	envelope := callCostHandler(t, CostChannelModels, "/api/cost/channel-models?days=30")
	rows := envelope["data"].([]any)
	require.Len(t, rows, 1)
	row := rows[0].(map[string]any)

	require.Nil(t, row["margin_rate"], "no priced revenue must yield no rate, not 0%%")
	require.Equal(t, float64(0), row["margin_quota"])
	require.Equal(t, float64(1), row["unknown_rate"], "all four requests were unpriced")
}

// Two channels serving one model: this is the view the whole feature exists for.
// The cheap upstream must read as profitable and the expensive one as lossy, and
// the unpriced-heavy row must not out-rank the genuinely healthy one.
func TestCostChannelModelsHandler_RanksChannelsForOneModel(t *testing.T) {
	db := newCostTestDB(t)
	seedCostDaily(t, db,
		model.ChannelCostDaily{
			ChannelId: 10, ModelName: "gpt-5", RequestCount: 10,
			RevenueQuota: 1000, CostQuota: 300,
		},
		model.ChannelCostDaily{
			ChannelId: 11, ModelName: "gpt-5", RequestCount: 10,
			RevenueQuota: 1000, CostQuota: 1200,
		},
	)

	envelope := callCostHandler(t, CostChannelModels, "/api/cost/channel-models?days=30&model=gpt-5")
	rows := envelope["data"].([]any)
	require.Len(t, rows, 2)

	byChannel := map[float64]map[string]any{}
	for _, r := range rows {
		row := r.(map[string]any)
		byChannel[row["channel_id"].(float64)] = row
	}

	cheap := byChannel[10]
	require.InDelta(t, 0.7, cheap["margin_rate"].(float64), 1e-9)

	lossy := byChannel[11]
	require.InDelta(t, -0.2, lossy["margin_rate"].(float64), 1e-9)
	require.Equal(t, float64(-200), lossy["margin_quota"])
}

// 毛利排序必须按 pricedMargin 的口径排，而不是按 SQL 的 revenue-cost。这两个
// 数字在有未定价流量时会分叉：下面 ch=21 的 revenue-cost 是 +400（看着最赚），
// 但它一半收入是未定价的，真实毛利只有 +100，排第二。榜单排错等于让运营照着
// 一个假名次去调渠道。
func TestCostChannelModelsHandler_MarginSortUsesPricedBasis(t *testing.T) {
	db := newCostTestDB(t)
	seedCostDaily(t, db,
		// 定价完整：毛利 800 - 500 = 300
		model.ChannelCostDaily{
			ChannelId: 20, ModelName: "gpt-5", RequestCount: 10,
			RevenueQuota: 800, CostQuota: 500,
		},
		// 一半收入未定价：SQL 口径 1000-600=400，真实口径 (1000-500)-600=-100
		model.ChannelCostDaily{
			ChannelId: 21, ModelName: "gpt-5", RequestCount: 10,
			RevenueQuota: 1000, CostQuota: 600,
			UnknownCount: 5, UnknownQuota: 500,
		},
	)

	envelope := callCostHandler(t, CostChannelModels, "/api/cost/channel-models?days=30&model=gpt-5&sort=margin")
	rows := envelope["data"].([]any)
	require.Len(t, rows, 2)

	first := rows[0].(map[string]any)
	second := rows[1].(map[string]any)
	require.Equal(t, float64(20), first["channel_id"], "按真实毛利，300 的那条该在前")
	require.Equal(t, float64(300), first["margin_quota"])
	require.Equal(t, float64(21), second["channel_id"])
	require.Equal(t, float64(-100), second["margin_quota"])
}

// 不传 sort 时维持收入降序：既有调用方（前端成本页）依赖这个顺序。
func TestCostChannelModelsHandler_DefaultSortStaysRevenue(t *testing.T) {
	db := newCostTestDB(t)
	seedCostDaily(t, db,
		model.ChannelCostDaily{
			ChannelId: 30, ModelName: "gpt-5", RequestCount: 10,
			RevenueQuota: 200, CostQuota: 10,
		},
		model.ChannelCostDaily{
			ChannelId: 31, ModelName: "gpt-5", RequestCount: 10,
			RevenueQuota: 900, CostQuota: 800,
		},
	)

	envelope := callCostHandler(t, CostChannelModels, "/api/cost/channel-models?days=30&model=gpt-5")
	rows := envelope["data"].([]any)
	require.Len(t, rows, 2)
	require.Equal(t, float64(31), rows[0].(map[string]any)["channel_id"], "默认按收入降序")
}

// 毛利率排序里算不出率的行（全是未定价流量）必须排在最后：那不是毛利为 0，
// 是这笔账还没法看，混进低毛利行里比就会把它当成亏损渠道。
func TestCostChannelModelsHandler_MarginRateSortPutsUnrankableLast(t *testing.T) {
	db := newCostTestDB(t)
	seedCostDaily(t, db,
		model.ChannelCostDaily{
			ChannelId: 40, ModelName: "gpt-5", RequestCount: 10,
			RevenueQuota: 500, CostQuota: 500, UnknownCount: 10, UnknownQuota: 500,
		},
		model.ChannelCostDaily{
			ChannelId: 41, ModelName: "gpt-5", RequestCount: 10,
			RevenueQuota: 1000, CostQuota: 900,
		},
	)

	envelope := callCostHandler(t, CostChannelModels, "/api/cost/channel-models?days=30&model=gpt-5&sort=margin_rate")
	rows := envelope["data"].([]any)
	require.Len(t, rows, 2)
	require.Equal(t, float64(41), rows[0].(map[string]any)["channel_id"])
	require.Nil(t, rows[1].(map[string]any)["margin_rate"], "算不出率的行排最后")
}
