package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 日汇总的切天口径必须是【服务器本地零点】，和交易账本 / 日志页渲染 created_at 的
// 口径一致。曾经这里按 UTC 零点切，UTC+8 下本地 00:00–08:00 的请求被算进前一天：
// 同一天账本 31 笔、日汇总 39 笔，多出来的 8 笔是次日凌晨那段。
//
// 顺带钉住 time.Date 而不是 ts/86400*86400：后者在非 UTC 时区把切点整体偏移一个
// 时区偏移量，本地零点前后的请求会分到相邻两天。
func TestCostDayTs_CutsAtServerLocalMidnight(t *testing.T) {
	cases := []struct {
		name string
		when time.Time
	}{
		{"本地零点整", time.Date(2026, 9, 23, 0, 0, 0, 0, time.Local)},
		{"本地零点后一秒", time.Date(2026, 9, 23, 0, 0, 1, 0, time.Local)},
		{"本地凌晨（UTC 口径下会被切到前一天）", time.Date(2026, 9, 24, 3, 17, 42, 0, time.Local)},
		{"本地正午", time.Date(2026, 9, 23, 12, 0, 0, 0, time.Local)},
		{"本地当天最后一秒", time.Date(2026, 9, 23, 23, 59, 59, 0, time.Local)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := costDayTs(tc.when.Unix())
			day := time.Unix(got, 0).In(time.Local)

			assert.Equal(t, tc.when.Year(), day.Year(), "切天不能跨年")
			assert.Equal(t, tc.when.Month(), day.Month(), "切天不能跨月")
			assert.Equal(t, tc.when.Day(), day.Day(),
				"%s 必须归到本地同一天，不能因时区偏移落到相邻日", tc.when.Format(time.RFC3339))
			assert.Equal(t, 0, day.Hour(), "切点必须是本地零点")
			assert.Equal(t, 0, day.Minute())
			assert.Equal(t, 0, day.Second())
		})
	}
}

// 同一本地日内的任意两个时刻必须落进同一个桶，跨过本地零点必须换桶。
// day_ts 是 channel_cost_daily 唯一索引的第一列，切错就是把一天的账拆成两行。
func TestCostDayTs_SameLocalDayShareBucket(t *testing.T) {
	early := time.Date(2026, 9, 23, 0, 0, 0, 0, time.Local).Unix()
	late := time.Date(2026, 9, 23, 23, 59, 59, 0, time.Local).Unix()
	nextDay := time.Date(2026, 9, 24, 0, 0, 0, 0, time.Local).Unix()

	assert.Equal(t, costDayTs(early), costDayTs(late), "同一本地日必须同桶")
	assert.NotEqual(t, costDayTs(late), costDayTs(nextDay), "跨本地零点必须换桶")
	assert.Equal(t, nextDay, costDayTs(nextDay), "本地零点自身是它那天的 day_ts")
}

// 这两条盯的是同一个事故：核算曾有一个默认关闭的总开关，RecordCostSample 第一行
// 就 return，于是 channel_cost_daily 一行不写，成本分析页整页 ¥0 —— 而交易账本
// 直读 logs，照常有数据。开关已删除，这里把"采样无条件记账"钉死，避免再被某个
// 前置条件悄悄截断。
func TestRecordCostSample_RecordsWithoutAnyGate(t *testing.T) {
	costBuckets.Clear()
	t.Cleanup(func() { costBuckets.Clear() })

	RecordCostSample(7, "deepseek-v4", 1200, 900, false, 0, 4096)

	key := costBucketKey{
		dayTs:     currentCostDayTs(),
		channelId: 7,
		modelName: "deepseek-v4",
	}
	actual, ok := costBuckets.Load(key)
	require.True(t, ok, "一笔请求必须在内存桶里留下账")

	b := actual.(*costBucket)
	assert.Equal(t, 1, b.requestCount)
	assert.Equal(t, int64(1200), b.revenueQuota)
	assert.Equal(t, int64(900), b.costQuota)
	assert.Equal(t, int64(4096), b.tokenUsed)
	assert.Zero(t, b.unknownCount)
}

// 未定价的一笔：收入照记，成本【不】记 —— 把 unknown 的 0 当成本会报出 100%
// 毛利。收入要单独进 unknownQuota，报表按已定价口径算毛利时要减掉它。
func TestRecordCostSample_UnknownKeepsRevenueOutOfCostBasis(t *testing.T) {
	costBuckets.Clear()
	t.Cleanup(func() { costBuckets.Clear() })

	RecordCostSample(7, "mystery-model", 500, 0, true, 0, 128)

	key := costBucketKey{
		dayTs:     currentCostDayTs(),
		channelId: 7,
		modelName: "mystery-model",
	}
	actual, ok := costBuckets.Load(key)
	require.True(t, ok)

	b := actual.(*costBucket)
	assert.Equal(t, 1, b.unknownCount)
	assert.Equal(t, int64(500), b.unknownQuota, "未定价收入要能被毛利分母减掉")
	assert.Equal(t, int64(500), b.revenueQuota)
	assert.Zero(t, b.costQuota)
}

// drain 必须把桶清零。曾经它只拷贝不清零，而落库是 OnConflict 累加 upsert，
// 于是每一轮 flush 都把【当前累计总量】再加一次进库：60 秒一轮的话，一笔真实
// 请求一天能被写成上千笔，报表和交易账本（直读 logs）的数字完全对不上。
// 这条测试盯的就是"drain 之后桶里不能还剩账"。
func TestDrainCostBuckets_ZeroesBucketSoFlushDoesNotDoubleCount(t *testing.T) {
	costBuckets.Clear()
	t.Cleanup(func() { costBuckets.Clear() })

	RecordCostSample(7, "deepseek-v4", 1200, 900, false, 0, 4096)

	first := drainCostBuckets()
	require.Len(t, first, 1, "第一次 drain 要取到这笔账")
	for _, b := range first {
		assert.Equal(t, 1, b.requestCount)
		assert.Equal(t, int64(1200), b.revenueQuota)
	}

	// 没有新请求进来，第二次 drain 不能再报出任何账。
	second := drainCostBuckets()
	for k, b := range second {
		assert.Zero(t, b.requestCount, "key=%+v 在 drain 后还剩 requestCount，会被重复累加进库", k)
		assert.Zero(t, b.revenueQuota, "key=%+v 在 drain 后还剩 revenueQuota", k)
		assert.Zero(t, b.costQuota, "key=%+v 在 drain 后还剩 costQuota", k)
		assert.Zero(t, b.tokenUsed, "key=%+v 在 drain 后还剩 tokenUsed", k)
	}
}

// drain 用"原地清零"而不是"删 key"来避免重复累加，因为 RecordCostSample 可能
// 已经拿着桶指针在等锁：删 key 会让那笔加法落到一个再也不会被 drain 的孤儿桶上。
// 这条盯的是 drain 之后到达的样本仍然能被下一轮取走。
func TestDrainCostBuckets_SampleAfterDrainStillFlushes(t *testing.T) {
	costBuckets.Clear()
	t.Cleanup(func() { costBuckets.Clear() })

	RecordCostSample(7, "deepseek-v4", 1200, 900, false, 0, 4096)
	require.Len(t, drainCostBuckets(), 1)

	RecordCostSample(7, "deepseek-v4", 300, 200, false, 0, 512)

	next := drainCostBuckets()
	require.Len(t, next, 1, "drain 之后到达的样本必须还能被取走，不能丢账")
	for _, b := range next {
		assert.Equal(t, 1, b.requestCount)
		assert.Equal(t, int64(300), b.revenueQuota, "只能是新那笔，不含已 flush 的部分")
		assert.Equal(t, int64(200), b.costQuota)
	}
}
