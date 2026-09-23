package service

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetChannelHealthCache(t *testing.T) {
	t.Helper()
	channelHealthMu.Lock()
	channelHealthCache = map[string]channelHealthCacheItem{}
	channelHealthMu.Unlock()
	groupAvailabilityMu.Lock()
	groupAvailabilityCache = map[string]groupAvailabilityCacheItem{}
	groupAvailabilityMu.Unlock()
	t.Cleanup(func() {
		channelHealthMu.Lock()
		channelHealthCache = map[string]channelHealthCacheItem{}
		channelHealthMu.Unlock()
		groupAvailabilityMu.Lock()
		groupAvailabilityCache = map[string]groupAvailabilityCacheItem{}
		groupAvailabilityMu.Unlock()
	})
}

// The state that made the card contradict itself: the channel table is empty
// while the group metrics behind the cards on the same screen are full. Falling
// back keeps the two rows telling the same story.
func TestAttachChannelHealth_FallsBackToGroupAvailability(t *testing.T) {
	resetChannelHealthCache(t)

	storeChannelHealth("glm-5.3", map[int]perfmetrics.ChannelHealth{})
	storeGroupAvailability("glm-5.3", map[string]groupHealth{"default": {successRate: 99.42, ttftMs: 1615}})

	routes := []*model.ChannelRoute{{ChannelID: 1, Groups: []string{"default"}}}
	attachChannelHealth("glm-5.3", routes)

	require.NotNil(t, routes[0].AvailabilityPct)
	assert.InDelta(t, 99.42, *routes[0].AvailabilityPct, 1e-9)
	assert.Equal(t, model.AvailabilitySourceGroup, routes[0].AvailabilitySource,
		"a borrowed figure must be labelled, not passed off as this channel's own")
}

// A channel's own measurement always wins. The group figure is a stand-in, and a
// stand-in that overrode real data would hide exactly the per-channel difference
// the card exists to show.
func TestAttachChannelHealth_ChannelFigureBeatsGroupFallback(t *testing.T) {
	resetChannelHealthCache(t)

	pct := 87.5
	storeChannelHealth("glm-5.3", map[int]perfmetrics.ChannelHealth{
		1: {AvailabilityPct: &pct, TtftMs: 840},
	})
	storeGroupAvailability("glm-5.3", map[string]groupHealth{"default": {successRate: 99.42, ttftMs: 1615}})

	routes := []*model.ChannelRoute{{ChannelID: 1, Groups: []string{"default"}}}
	attachChannelHealth("glm-5.3", routes)

	assert.InDelta(t, 87.5, *routes[0].AvailabilityPct, 1e-9)
	assert.Equal(t, model.AvailabilitySourceChannel, routes[0].AvailabilitySource)
}

// A channel measured at 0% has failed every request. That is real data and must
// survive: overwriting it with a healthy group average would advertise a dead
// line as working.
func TestAttachChannelHealth_ZeroChannelRateIsNotOverwritten(t *testing.T) {
	resetChannelHealthCache(t)

	zero := 0.0
	storeChannelHealth("glm-5.3", map[int]perfmetrics.ChannelHealth{
		1: {AvailabilityPct: &zero},
	})
	storeGroupAvailability("glm-5.3", map[string]groupHealth{"default": {successRate: 99.42, ttftMs: 1615}})

	routes := []*model.ChannelRoute{{ChannelID: 1, Groups: []string{"default"}}}
	attachChannelHealth("glm-5.3", routes)

	require.NotNil(t, routes[0].AvailabilityPct)
	assert.Zero(t, *routes[0].AvailabilityPct, "0% is a measurement, not a missing value")
	assert.Equal(t, model.AvailabilitySourceChannel, routes[0].AvailabilitySource)
}

// Pins the wire format, because the bug that survived three rounds was a field
// missing from the JSON rather than anything wrong in the UI.
func TestChannelRoute_HealthFieldsAppearOnTheWire(t *testing.T) {
	resetChannelHealthCache(t)

	storeChannelHealth("glm-5.3", map[int]perfmetrics.ChannelHealth{})
	storeGroupAvailability("glm-5.3", map[string]groupHealth{
		"default": {successRate: 100, ttftMs: 1615},
	})

	routes := []*model.ChannelRoute{{ChannelID: 1, Groups: []string{"default"}}}
	attachChannelHealth("glm-5.3", routes)

	encoded, err := json.Marshal(routes[0])
	require.NoError(t, err)

	body := string(encoded)
	assert.Contains(t, body, `"availability_pct":100`)
	assert.Contains(t, body, `"ttft_ms":1615`)
	assert.Contains(t, body, `"availability_source":"group"`)
	assert.Contains(t, body, `"ttft_source":"group"`)
}

func TestBestGroupRate_PrefersTheWorstReachableGroup(t *testing.T) {
	rates := map[string]groupHealth{
		"default": {successRate: 99.9},
		"vip":     {successRate: 91.2},
		"other":   {successRate: 80.0},
	}

	// The quote has to hold whichever group serves the request, so the weakest of
	// the channel's own groups is the honest figure — and groups it does not serve
	// must not drag it down.
	rate, found := bestGroupRate(rates, []string{"default", "vip"})
	require.True(t, found)
	assert.InDelta(t, 91.2, rate.successRate, 1e-9)

	_, found = bestGroupRate(rates, []string{"unmeasured"})
	assert.False(t, found)
}

// The gap that kept the first-token slot empty for three rounds: availability fell
// back to the group figure but first-token time had no fallback at all, so a
// channel with no streaming traffic of its own showed a dash next to a borrowed
// percentage.
func TestAttachChannelHealth_FallsBackToGroupTtft(t *testing.T) {
	resetChannelHealthCache(t)

	storeChannelHealth("glm-5.3", map[int]perfmetrics.ChannelHealth{})
	storeGroupAvailability("glm-5.3", map[string]groupHealth{
		"default": {successRate: 100, ttftMs: 1615},
	})

	routes := []*model.ChannelRoute{{ChannelID: 1, Groups: []string{"default"}}}
	attachChannelHealth("glm-5.3", routes)

	assert.Equal(t, int64(1615), routes[0].TtftMs)
	assert.Equal(t, model.AvailabilitySourceGroup, routes[0].TtftSource)
}

// A channel that has served only non-streaming requests has a real availability
// figure and no first-token time. The two fields have to fall back independently,
// or a measured number gets relabelled as borrowed.
func TestAttachChannelHealth_MixedSourcesAreLabelledSeparately(t *testing.T) {
	resetChannelHealthCache(t)

	pct := 98.0
	storeChannelHealth("glm-5.3", map[int]perfmetrics.ChannelHealth{
		1: {AvailabilityPct: &pct, TtftMs: 0},
	})
	storeGroupAvailability("glm-5.3", map[string]groupHealth{
		"default": {successRate: 100, ttftMs: 1615},
	})

	routes := []*model.ChannelRoute{{ChannelID: 1, Groups: []string{"default"}}}
	attachChannelHealth("glm-5.3", routes)

	assert.InDelta(t, 98.0, *routes[0].AvailabilityPct, 1e-9)
	assert.Equal(t, model.AvailabilitySourceChannel, routes[0].AvailabilitySource)
	assert.Equal(t, int64(1615), routes[0].TtftMs)
	assert.Equal(t, model.AvailabilitySourceGroup, routes[0].TtftSource)
}

// The state every install is in on the day this ships: the channel metrics table
// is empty. That empty answer has to be cached like any other, or a public
// endpoint an anonymous visitor can poll re-queries a week of buckets on every
// single request — the exact cost the cache exists to avoid, incurred precisely
// when there is nothing to show.
func TestChannelHealthCache_CachesTheEmptyAnswer(t *testing.T) {
	resetChannelHealthCache(t)

	storeChannelHealth("glm-5.3", map[int]perfmetrics.ChannelHealth{})

	health, ok := cachedChannelHealth("glm-5.3")
	assert.True(t, ok, "an empty result is a result; re-querying it defeats the cache")
	assert.Empty(t, health)
}

func TestChannelHealthCache_ExpiredEntryIsAMiss(t *testing.T) {
	resetChannelHealthCache(t)

	pct := 99.76
	channelHealthMu.Lock()
	channelHealthCache["glm-5.3"] = channelHealthCacheItem{
		health:    map[int]perfmetrics.ChannelHealth{7: {AvailabilityPct: &pct}},
		expiresAt: time.Now().Add(-time.Second),
	}
	channelHealthMu.Unlock()

	_, ok := cachedChannelHealth("glm-5.3")
	assert.False(t, ok)
}

// A channel with no samples must come out of attachChannelHealth with a nil
// availability, not a zero. Zero is "every request failed" and paints a working
// line red; nil is "not measured" and renders as no data.
func TestAttachChannelHealth_LeavesUnmeasuredChannelsNil(t *testing.T) {
	resetChannelHealthCache(t)

	pct := 99.76
	storeChannelHealth("glm-5.3", map[int]perfmetrics.ChannelHealth{
		1: {AvailabilityPct: &pct, TtftMs: 840},
	})
	// Empty, so no group figure can stand in: this test is about the unmeasured
	// case staying nil. Stored rather than left absent to keep the test off the
	// database.
	storeGroupAvailability("glm-5.3", map[string]groupHealth{})

	routes := []*model.ChannelRoute{
		{ChannelID: 1},
		{ChannelID: 2},
	}
	attachChannelHealth("glm-5.3", routes)

	require.NotNil(t, routes[0].AvailabilityPct)
	assert.InDelta(t, 99.76, *routes[0].AvailabilityPct, 1e-9)
	assert.Equal(t, int64(840), routes[0].TtftMs)

	assert.Nil(t, routes[1].AvailabilityPct, "never called is not the same as always failing")
	assert.Zero(t, routes[1].TtftMs)
}
