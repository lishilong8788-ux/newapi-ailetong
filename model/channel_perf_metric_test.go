package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newChannelPerfTestDB(t *testing.T) {
	t.Helper()
	oldDB := DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&ChannelPerfMetric{}))
	DB = db
	t.Cleanup(func() {
		DB = oldDB
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
}

// The upsert has to accumulate rather than replace: one channel's availability is
// summed across every flush in the window, and a flush that overwrote the
// previous one would report only the last few minutes as if it were the week.
func TestUpsertChannelPerfMetric_AccumulatesAcrossFlushes(t *testing.T) {
	newChannelPerfTestDB(t)

	for range 3 {
		require.NoError(t, UpsertChannelPerfMetric(&ChannelPerfMetric{
			ChannelId:    7,
			ModelName:    "glm-5.3",
			BucketTs:     1000,
			RequestCount: 10,
			SuccessCount: 9,
			TtftSumMs:    2000,
			TtftCount:    8,
		}))
	}

	summaries, err := GetChannelPerfSummary("glm-5.3", 0, 2000)
	require.NoError(t, err)
	require.Len(t, summaries, 1)

	assert.Equal(t, int64(30), summaries[0].RequestCount)
	assert.Equal(t, int64(27), summaries[0].SuccessCount)
	assert.Equal(t, int64(6000), summaries[0].TtftSumMs)
	assert.Equal(t, int64(24), summaries[0].TtftCount)
}

func TestGetChannelPerfSummary_GroupsPerChannelWithinWindow(t *testing.T) {
	newChannelPerfTestDB(t)

	rows := []ChannelPerfMetric{
		// Two buckets for one channel, to prove they are summed, not listed.
		{ChannelId: 1, ModelName: "glm-5.3", BucketTs: 1000, RequestCount: 100, SuccessCount: 100, TtftSumMs: 50_000, TtftCount: 100},
		{ChannelId: 1, ModelName: "glm-5.3", BucketTs: 2000, RequestCount: 100, SuccessCount: 90, TtftSumMs: 70_000, TtftCount: 100},
		// A second channel on the same model must stay a separate row.
		{ChannelId: 2, ModelName: "glm-5.3", BucketTs: 1000, RequestCount: 4, SuccessCount: 0, TtftSumMs: 0, TtftCount: 0},
		// Outside the window, and a different model: neither may leak in.
		{ChannelId: 3, ModelName: "glm-5.3", BucketTs: 99, RequestCount: 500, SuccessCount: 500},
		{ChannelId: 4, ModelName: "gpt-5.6", BucketTs: 1000, RequestCount: 500, SuccessCount: 500},
	}
	for i := range rows {
		require.NoError(t, UpsertChannelPerfMetric(&rows[i]))
	}

	summaries, err := GetChannelPerfSummary("glm-5.3", 1000, 2000)
	require.NoError(t, err)
	require.Len(t, summaries, 2)

	byChannel := make(map[int]ChannelPerfSummary, len(summaries))
	for _, summary := range summaries {
		byChannel[summary.ChannelId] = summary
	}

	require.Contains(t, byChannel, 1)
	assert.Equal(t, int64(200), byChannel[1].RequestCount)
	assert.Equal(t, int64(190), byChannel[1].SuccessCount)
	assert.Equal(t, int64(120_000), byChannel[1].TtftSumMs)

	// A channel that failed every request must survive aggregation as a real row
	// with zero successes. Dropping it would make a broken line indistinguishable
	// from one nobody has called, which is the one distinction the card exists to
	// draw.
	require.Contains(t, byChannel, 2)
	assert.Equal(t, int64(4), byChannel[2].RequestCount)
	assert.Zero(t, byChannel[2].SuccessCount)
}

func TestGetChannelPerfSummary_EmptyModelNameQueriesNothing(t *testing.T) {
	newChannelPerfTestDB(t)
	require.NoError(t, UpsertChannelPerfMetric(&ChannelPerfMetric{
		ChannelId: 1, ModelName: "glm-5.3", BucketTs: 1000, RequestCount: 5, SuccessCount: 5,
	}))

	summaries, err := GetChannelPerfSummary("", 0, 2000)
	require.NoError(t, err)
	assert.Empty(t, summaries, "an unnamed model must not match every channel's rows")
}
