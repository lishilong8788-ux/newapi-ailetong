package model

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ChannelPerfMetric aggregates relay outcomes per upstream channel, so the
// catalog can answer "how reliable is this line" and "how fast does it start
// answering" for one model.
//
// A separate table from PerfMetric rather than a channel_id column on it: that
// table's uniqueness is (model_name, group, bucket_ts), and widening it means
// rebuilding the unique index — which GORM AutoMigrate does not do for an index
// that already exists, leaving the old constraint to reject rows that differ
// only by channel. A new table is a plain CREATE on SQLite, MySQL and Postgres
// alike.
//
// No group dimension: a channel's availability is a property of the upstream
// line, not of the membership tier a buyer reaches it through.
type ChannelPerfMetric struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	ChannelId int    `json:"channel_id" gorm:"uniqueIndex:idx_cpm_channel_model_bucket,priority:1"`
	ModelName string `json:"model_name" gorm:"size:128;uniqueIndex:idx_cpm_channel_model_bucket,priority:2"`
	BucketTs  int64  `json:"bucket_ts" gorm:"uniqueIndex:idx_cpm_channel_model_bucket,priority:3;index:idx_cpm_bucket_ts"`
	// RequestCount counts successes plus every failed attempt, including attempts
	// a retry later rescued. See perfmetrics.RecordChannelFailure for why the
	// failure side is sampled inside the retry loop rather than after it.
	RequestCount int64 `json:"-" gorm:"default:0"`
	SuccessCount int64 `json:"-" gorm:"default:0"`
	// TtftSumMs/TtftCount are only fed by streaming requests, the only ones with
	// an observable first token. A channel serving non-stream traffic alone
	// reports no TTFT, which is honest; its availability is unaffected.
	TtftSumMs int64 `json:"-" gorm:"default:0"`
	TtftCount int64 `json:"-" gorm:"default:0"`
}

func (ChannelPerfMetric) TableName() string {
	return "channel_perf_metrics"
}

func UpsertChannelPerfMetric(metric *ChannelPerfMetric) error {
	if metric == nil || metric.RequestCount == 0 {
		return nil
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "channel_id"},
			{Name: "model_name"},
			{Name: "bucket_ts"},
		},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"request_count": gorm.Expr("channel_perf_metrics.request_count + ?", metric.RequestCount),
			"success_count": gorm.Expr("channel_perf_metrics.success_count + ?", metric.SuccessCount),
			"ttft_sum_ms":   gorm.Expr("channel_perf_metrics.ttft_sum_ms + ?", metric.TtftSumMs),
			"ttft_count":    gorm.Expr("channel_perf_metrics.ttft_count + ?", metric.TtftCount),
		}),
	}).Create(metric).Error
}

// ChannelPerfSummary is one channel's totals for one model over a window.
type ChannelPerfSummary struct {
	ChannelId    int   `json:"channel_id"`
	RequestCount int64 `json:"request_count"`
	SuccessCount int64 `json:"success_count"`
	TtftSumMs    int64 `json:"ttft_sum_ms"`
	TtftCount    int64 `json:"ttft_count"`
}

func GetChannelPerfSummary(modelName string, startTs int64, endTs int64) ([]ChannelPerfSummary, error) {
	var summaries []ChannelPerfSummary
	if modelName == "" {
		return summaries, nil
	}
	err := DB.Model(&ChannelPerfMetric{}).
		Select("channel_id, SUM(request_count) as request_count, SUM(success_count) as success_count, SUM(ttft_sum_ms) as ttft_sum_ms, SUM(ttft_count) as ttft_count").
		Where("model_name = ? AND bucket_ts >= ? AND bucket_ts <= ?", modelName, startTs, endTs).
		Group("channel_id").
		Having("SUM(request_count) > 0").
		Find(&summaries).Error
	return summaries, err
}

func DeleteChannelPerfMetricsBefore(cutoffTs int64) error {
	if cutoffTs <= 0 {
		return nil
	}
	return DB.Where("bucket_ts < ?", cutoffTs).Delete(&ChannelPerfMetric{}).Error
}
