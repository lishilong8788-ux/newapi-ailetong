package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	costsetting "github.com/QuantumNous/new-api/setting/cost_setting"
)

// 渠道成本日汇总的内存桶 + 定时 flush。
// 仿 perf_metrics 的"失败回填 + OnConflict 累加 upsert"，不仿 batchUpdate
// （map[int]int] 表达不了复合键、flush 失败静默丢弃、退出无补刷）。

type costBucketKey struct {
	dayTs     int64
	channelId int
	modelName string
}

type costBucket struct {
	mu            sync.Mutex
	requestCount  int
	tokenUsed     int64
	revenueQuota  int64
	costQuota     int64
	unknownCount  int
	unknownQuota  int64
	reportedQuota int64
}

var costBuckets sync.Map // costBucketKey -> *costBucket

// costDayTs 把一个时刻归到它所属那天的零点。这是日汇总的切天口径，唯一一处定义：
// 实时 flush（currentCostDayTs）和历史重算（cost_recalc.go）都必须走它，两边各切
// 一次的话同一笔请求会落到不同的 day_ts，重算结果和增量结果对不上。
//
// 用【服务器本地零点】而不是 UTC 零点：交易账本和日志页都按本地时区渲染
// created_at，日汇总必须同口径。UTC 口径下 UTC+8 的本地 00:00–08:00 会被算进前一
// 天，两个页面按"某一天"对账就差出这段窗口——曾经 09-23 账本 31 笔、日汇总 39 笔，
// 多出来的 8 笔全是本地 09-24 凌晨那段。
//
// 用 time.Date 而不是 ts/86400*86400：后者假设每天恰好 86400 秒、且第 0 天正好从
// 本地零点起算。前者在有 DST 的时区不成立，后者只在 UTC 成立，两个前提都错时切点
// 会整体偏移。
func costDayTs(ts int64) int64 {
	t := time.Unix(ts, 0).In(time.Local)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local).Unix()
}

func currentCostDayTs() int64 {
	return costDayTs(time.Now().Unix())
}

// RecordCostSample 由 attachUpstreamCost 同步调用（在其调用的结算路径上），
// 只做内存累加，不碰 DB。
func RecordCostSample(channelId int, modelName string, revenue int, costQuota int,
	unknown bool, reportedQuota int64, tokenUsed int64) {
	key := costBucketKey{
		dayTs:     currentCostDayTs(),
		channelId: channelId,
		modelName: modelName,
	}
	actual, _ := costBuckets.LoadOrStore(key, &costBucket{})
	b := actual.(*costBucket)
	b.mu.Lock()
	b.requestCount++
	b.tokenUsed += tokenUsed
	b.revenueQuota += int64(revenue)
	if unknown {
		b.unknownCount++
		b.unknownQuota += int64(revenue)
	} else {
		b.costQuota += int64(costQuota)
	}
	b.reportedQuota += reportedQuota
	b.mu.Unlock()
}

// drainCostBuckets 取走全部桶数据，并【在同一把锁里清零】。
//
// 清零是这个函数的正确性核心，不是收尾动作：落库走的是 OnConflict 累加 upsert
// （UpsertChannelCostDaily 里是 quota + ?），语义上 flush 提交的是"自上次 flush
// 以来的增量"。只拷不清就等于每轮都把累计总量当增量再提交一次，落库值会变成
// Σ(每轮的累计值)——60 秒一轮时一笔真实请求一天能被放大成上千笔，而交易账本直读
// logs 不受影响，两边数字对不上。
//
// 清零而不是删 key：RecordCostSample 可能已经拿着这个 *costBucket 的指针在等锁，
// 删 key 会让它把账加到一个再也不会被 drain 的孤儿桶上，直接丢账。清零后那笔加法
// 落在同一个对象上，下一轮照常取走。
//
// 例外是非今天的 key：dayTs 取自 time.Now()，新样本只会落到今天的桶，所以昨天
// 及更早的桶一旦清空就不可能再被写入，可以安全删掉，否则 map 会按天无界增长。
func drainCostBuckets() map[costBucketKey]*costBucket {
	drained := make(map[costBucketKey]*costBucket)
	today := currentCostDayTs()
	costBuckets.Range(func(key, value any) bool {
		k := key.(costBucketKey)
		b := value.(*costBucket)
		b.mu.Lock()
		snapshot := &costBucket{
			requestCount:  b.requestCount,
			tokenUsed:     b.tokenUsed,
			revenueQuota:  b.revenueQuota,
			costQuota:     b.costQuota,
			unknownCount:  b.unknownCount,
			unknownQuota:  b.unknownQuota,
			reportedQuota: b.reportedQuota,
		}
		b.requestCount = 0
		b.tokenUsed = 0
		b.revenueQuota = 0
		b.costQuota = 0
		b.unknownCount = 0
		b.unknownQuota = 0
		b.reportedQuota = 0
		b.mu.Unlock()

		if snapshot.requestCount > 0 {
			drained[k] = snapshot
		} else if k.dayTs < today {
			// 已清空且不会再被写入的历史桶，回收掉。
			costBuckets.Delete(k)
		}
		return true
	})
	return drained
}

// flushCostBuckets 把桶数据落库；失败的桶回填到内存，等下一轮。
func flushCostBuckets() {
	drained := drainCostBuckets()
	for k, v := range drained {
		if v.requestCount == 0 {
			continue
		}
		row := &model.ChannelCostDaily{
			DayTs:         k.dayTs,
			ChannelId:     k.channelId,
			ModelName:     k.modelName,
			RequestCount:  v.requestCount,
			TokenUsed:     v.tokenUsed,
			RevenueQuota:  v.revenueQuota,
			CostQuota:     v.costQuota,
			UnknownCount:  v.unknownCount,
			UnknownQuota:  v.unknownQuota,
			ReportedQuota: v.reportedQuota,
		}
		if err := model.UpsertChannelCostDaily(row); err != nil {
			// 回填：账务数据的底线是不丢数。
			actual, _ := costBuckets.LoadOrStore(k, &costBucket{})
			b := actual.(*costBucket)
			b.mu.Lock()
			b.requestCount += v.requestCount
			b.tokenUsed += v.tokenUsed
			b.revenueQuota += v.revenueQuota
			b.costQuota += v.costQuota
			b.unknownCount += v.unknownCount
			b.unknownQuota += v.unknownQuota
			b.reportedQuota += v.reportedQuota
			b.mu.Unlock()
			common.SysError(fmt.Sprintf("failed to flush cost bucket channel=%d model=%s day=%d: %s",
				k.channelId, k.modelName, k.dayTs, err.Error()))
		}
	}
}

// StartCostFlushLoop 启动定时 flush。多实例部署下每个节点独立 flush 自己
// 观察到的样本，OnConflict 累加保证幂等。
func StartCostFlushLoop() {
	go func() {
		for {
			time.Sleep(time.Duration(costsetting.GetFlushIntervalSeconds()) * time.Second)
			flushCostBuckets()
		}
	}()
}

// FlushCostBucketsOnExit 退出路径补刷（main.go 调用）。
func FlushCostBucketsOnExit() {
	flushCostBuckets()
	logger.LogInfo(nil, "cost buckets flushed on exit")
}
