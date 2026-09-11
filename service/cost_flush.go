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

// RecordCostSample 由 attachUpstreamCost 同步调用（在其调用的结算路径上），
// 只做内存累加，不碰 DB。
func RecordCostSample(channelId int, modelName string, revenue int, costQuota int,
	unknown bool, reportedQuota int64, tokenUsed int64) {
	if !costsetting.GetSetting().Enabled {
		return
	}
	key := costBucketKey{
		dayTs:     time.Now().Unix() / 86400 * 86400,
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

// drainCostBuckets 取走全部桶数据。flush 失败时把 drained 加回（回填），
// 保证不丢账。
func drainCostBuckets() map[costBucketKey]*costBucket {
	drained := make(map[costBucketKey]*costBucket)
	costBuckets.Range(func(key, value any) bool {
		k := key.(costBucketKey)
		b := value.(*costBucket)
		b.mu.Lock()
		drained[k] = &costBucket{
			requestCount:  b.requestCount,
			tokenUsed:     b.tokenUsed,
			revenueQuota:  b.revenueQuota,
			costQuota:     b.costQuota,
			unknownCount:  b.unknownCount,
			unknownQuota:  b.unknownQuota,
			reportedQuota: b.reportedQuota,
		}
		b.mu.Unlock()
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
			if !costsetting.GetSetting().Enabled {
				continue
			}
			flushCostBuckets()
		}
	}()
}

// FlushCostBucketsOnExit 退出路径补刷（main.go 调用）。
func FlushCostBucketsOnExit() {
	if !costsetting.GetSetting().Enabled {
		return
	}
	flushCostBuckets()
	logger.LogInfo(nil, "cost buckets flushed on exit")
}
