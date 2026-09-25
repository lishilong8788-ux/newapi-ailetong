package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// withMemoryCacheDisabled runs the DB selection path: the existing line-code tests
// all go through autoRouteFixture, which forces MemoryCacheEnabled on, so the
// fallback path shipped with no coverage at all — and line pinning was silently
// inert there, because the published-code set was only built inside the cached
// branch and the pin argument was dropped on the way to GetChannel.
func withMemoryCacheDisabled(t *testing.T) {
	t.Helper()
	original := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = original })
	RefreshKnownLineCodes()
}

func TestRefreshKnownLineCodesWithoutMemoryCache(t *testing.T) {
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 401, priority: 10, lineCode: "hs10"},
		{id: 402, priority: 10, lineCode: "tx8"},
	})
	withMemoryCacheDisabled(t)

	bare, code, pinned := SplitModelLineCode("default", autoRouteTestModel+"/hs10")
	assert.True(t, pinned, "a published line code must parse as a pin with the cache off")
	assert.Equal(t, autoRouteTestModel, bare)
	assert.Equal(t, "hs10", code)
}

// Distinct priorities are the point: the DB path resolves priority with
// MAX(priority) across the whole model, so a pin naming a lower-priority line was
// silently inert — candidates collapsed to the globally top channel before the line
// was ever considered. Equal priorities hide the bug entirely.
func TestGetChannelPinSelectsLowerPriorityLineWithoutMemoryCache(t *testing.T) {
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 401, priority: 10, lineCode: "hs10"},
		{id: 402, priority: 9, lineCode: "tx8"},
	})
	withMemoryCacheDisabled(t)

	for i := 0; i < 30; i++ {
		channel, err := GetRandomSatisfiedChannelOnLine("default", autoRouteTestModel, 0, "", "tx8")
		require.NoError(t, err)
		require.NotNil(t, channel)
		require.Equal(t, 402, channel.Id, "the pinned line must win every time, not usually")
	}
}

// Retries must walk the pinned line's own priority tiers. Counting tiers across the
// whole model would step onto a priority the line does not publish and select
// nothing, breaking failover within the line.
func TestGetChannelPinRetriesStayOnLineWithoutMemoryCache(t *testing.T) {
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 401, priority: 10, lineCode: "hs10"},
		{id: 402, priority: 9, lineCode: "tx8"},
		{id: 403, priority: 8, lineCode: "tx8"},
	})
	withMemoryCacheDisabled(t)

	first, err := GetRandomSatisfiedChannelOnLine("default", autoRouteTestModel, 0, "", "tx8")
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, 402, first.Id, "retry 0 takes the line's own top tier")

	second, err := GetRandomSatisfiedChannelOnLine("default", autoRouteTestModel, 1, "", "tx8")
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, 403, second.Id, "retry 1 falls to the line's next tier, not off the line")
}

func TestGetChannelMissedPinFallsBackWithoutMemoryCache(t *testing.T) {
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 401, priority: 10, lineCode: "hs10"},
		{id: 402, priority: 10, lineCode: "tx8"},
	})
	withMemoryCacheDisabled(t)

	// A line no channel publishes is a preference that cannot be honored, not a
	// restriction: the request must still be served rather than 503.
	channel, err := GetRandomSatisfiedChannelOnLine("default", autoRouteTestModel, 0, "", "nosuchline")
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Contains(t, []int{401, 402}, channel.Id)
}
