package perfmetrics

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func drainChannelBuckets(t *testing.T) map[channelBucketKey]counters {
	t.Helper()
	out := map[channelBucketKey]counters{}
	channelHotBuckets.Range(func(key, value any) bool {
		out[key.(channelBucketKey)] = value.(*atomicBucket).snapshot()
		channelHotBuckets.Delete(key)
		return true
	})
	return out
}

// Channel availability is only as honest as its denominator. A request that
// failed on one channel and was rescued by a retry on another must be charged to
// the channel that failed — that is precisely the event a buyer reading
// availability wants to know about, and the after-the-loop model sample cannot
// express it.
func TestRecordChannel_CountsEveryFailedAttemptAgainstItsOwnChannel(t *testing.T) {
	t.Cleanup(func() { drainChannelBuckets(t) })
	drainChannelBuckets(t)

	// Channel 1 failed, the retry on channel 2 succeeded.
	recordChannel(1, "glm-5.3", false, 0, false)
	recordChannel(2, "glm-5.3", true, 900, true)

	buckets := drainChannelBuckets(t)
	require.Len(t, buckets, 2)

	bucketTs := bucketStart(time.Now().Unix())
	failed := buckets[channelBucketKey{channelID: 1, model: "glm-5.3", bucketTs: bucketTs}]
	assert.Equal(t, int64(1), failed.requestCount)
	assert.Zero(t, failed.successCount, "the rescued request must still count as this channel's failure")

	ok := buckets[channelBucketKey{channelID: 2, model: "glm-5.3", bucketTs: bucketTs}]
	assert.Equal(t, int64(1), ok.requestCount)
	assert.Equal(t, int64(1), ok.successCount)
	assert.Equal(t, int64(900), ok.ttftSumMs)
	assert.Equal(t, int64(1), ok.ttftCount)
}

// A non-streaming request has no observable first token. Recording a zero would
// drag the channel's mean TTFT toward zero and advertise a speed it never
// demonstrated, so the sample must leave the TTFT counters untouched while still
// counting toward availability.
func TestRecordChannel_NonStreamingRequestCountsWithoutFakingTtft(t *testing.T) {
	t.Cleanup(func() { drainChannelBuckets(t) })
	drainChannelBuckets(t)

	recordChannel(5, "glm-5.3", true, 0, false)

	buckets := drainChannelBuckets(t)
	require.Len(t, buckets, 1)
	for _, bucket := range buckets {
		assert.Equal(t, int64(1), bucket.requestCount)
		assert.Equal(t, int64(1), bucket.successCount)
		assert.Zero(t, bucket.ttftCount, "no TTFT observation to average")
		assert.Zero(t, bucket.ttftSumMs)
	}
}

func TestRecordChannel_IgnoresSamplesWithNoChannelOrModel(t *testing.T) {
	t.Cleanup(func() { drainChannelBuckets(t) })
	drainChannelBuckets(t)

	// A relay that failed before a channel was picked carries channel id 0. It is
	// a real failure of the request, but there is no line to charge it to.
	recordChannel(0, "glm-5.3", false, 0, false)
	recordChannel(9, "", false, 0, false)

	assert.Empty(t, drainChannelBuckets(t))
}
