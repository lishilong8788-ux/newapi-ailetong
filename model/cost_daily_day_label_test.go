package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// day_ts 是【服务器本地零点】的 unix 时间戳，所以"这个桶属于哪一天"是服务器的事实。
// 前端拿裸时间戳只能按浏览器时区反推，两边时区不一致时日期标签整体错一天：UTC+8 的
// 09-23 零点在 UTC 浏览器上是 09-22 16:00，标签就成了 09-22。副驾同理——它不知道
// 服务器时区，转述给站长的日期必须和页面一致。
//
// 这条钉住服务端下发的标签与 day_ts 所属本地日一致，以及跨天聚合行（day_ts 投影成
// 常量 0）不能被格式化成 1970-01-01。
func TestFillLocalDayLabels(t *testing.T) {
	day := func(y int, m time.Month, d int) int64 {
		return time.Date(y, m, d, 0, 0, 0, 0, time.Local).Unix()
	}

	rows := []CostDailyAgg{
		{DayTs: day(2026, 9, 23)},
		{DayTs: day(2026, 9, 24)},
		{DayTs: day(2026, 12, 31)},
		{DayTs: 0}, // 跨天聚合：不属于任何一天
	}

	got := fillLocalDayLabels(rows)

	assert.Equal(t, "2026-09-23", got[0].Day)
	assert.Equal(t, "2026-09-24", got[1].Day)
	assert.Equal(t, "2026-12-31", got[2].Day)
	assert.Empty(t, got[3].Day,
		"day_ts=0 是跨天聚合的投影常量，格式化会得出 1970-01-01，比留空更容易被当成真数据")
}

// 标签必须复述 day_ts 自己那一天，不能受当天时刻影响——一天之内的任意时刻传进来都
// 该得到同一个日期。day_ts 理论上总是零点，但聚合查询的口径改动史上出过偏移，标签
// 不该在那种情况下悄悄换一天。
func TestFillLocalDayLabels_LabelsTheDayTheTimestampFallsIn(t *testing.T) {
	for _, hour := range []int{0, 1, 8, 12, 23} {
		ts := time.Date(2026, 9, 23, hour, 30, 0, 0, time.Local).Unix()
		got := fillLocalDayLabels([]CostDailyAgg{{DayTs: ts}})
		assert.Equal(t, "2026-09-23", got[0].Day,
			"本地 %02d:30 必须仍标为 09-23", hour)
	}
}
