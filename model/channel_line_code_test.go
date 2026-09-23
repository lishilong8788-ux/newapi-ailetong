package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// selectedChannelIDsOnLine samples line-pinned selection many times, so a pin
// that only usually holds is distinguishable from one that always holds.
func selectedChannelIDsOnLine(t *testing.T, retry int, lineCode string) map[int]int {
	t.Helper()
	counts := make(map[int]int)
	for i := 0; i < 60; i++ {
		channel, err := GetRandomSatisfiedChannelOnLine("default", autoRouteTestModel, retry, "", lineCode)
		require.NoError(t, err)
		require.NotNil(t, channel)
		counts[channel.Id]++
	}
	return counts
}

func TestSplitModelLineCode(t *testing.T) {
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 301, priority: 10, lineCode: "hs10"},
		{id: 302, priority: 10, lineCode: "tx8"},
	})

	t.Run("published code splits off as a pin", func(t *testing.T) {
		bare, code, pinned := SplitModelLineCode("default", autoRouteTestModel+"/hs10")
		assert.True(t, pinned)
		assert.Equal(t, autoRouteTestModel, bare)
		assert.Equal(t, "hs10", code)
	})

	t.Run("unpublished suffix is part of the model name", func(t *testing.T) {
		// The decisive case for vendor-namespaced models: nothing publishes
		// "qwen3", so "qwen/qwen3" must survive intact rather than resolving to
		// model "qwen" on a line nobody runs.
		bare, code, pinned := SplitModelLineCode("default", "qwen/qwen3")
		assert.False(t, pinned)
		assert.Equal(t, "qwen/qwen3", bare)
		assert.Empty(t, code)
	})

	t.Run("bare model name is untouched", func(t *testing.T) {
		bare, code, pinned := SplitModelLineCode("default", autoRouteTestModel)
		assert.False(t, pinned)
		assert.Equal(t, autoRouteTestModel, bare)
		assert.Empty(t, code)
	})

	t.Run("trailing slash is not a pin", func(t *testing.T) {
		_, _, pinned := SplitModelLineCode("default", autoRouteTestModel+"/")
		assert.False(t, pinned)
	})

	t.Run("leading slash is not a pin", func(t *testing.T) {
		// Splitting here would leave an empty model name, which resolves to no
		// ability and fails the request instead of passing the name through.
		_, _, pinned := SplitModelLineCode("default", "/hs10")
		assert.False(t, pinned)
	})
}

func TestSplitModelLineCode_RegisteredLiteralWinsOverPin(t *testing.T) {
	// An operator who registered the literal slashed name means that name. Reading
	// it as a pin would route it to the bare model, which may not exist at all.
	literal := autoRouteTestModel + "/hs10"
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 311, priority: 10, lineCode: "hs10"},
	})
	require.NoError(t, DB.Exec("UPDATE channels SET models = ? WHERE id = ?", literal, 311).Error)
	require.NoError(t, DB.Exec("UPDATE abilities SET model = ? WHERE channel_id = ?", literal, 311).Error)
	InitChannelCache()

	bare, code, pinned := SplitModelLineCode("default", literal)
	assert.False(t, pinned)
	assert.Equal(t, literal, bare)
	assert.Empty(t, code)
}

func TestSplitModelLineCode_DisabledChannelPublishesNothing(t *testing.T) {
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 321, priority: 10, lineCode: "hs10"},
	})
	require.NoError(t, DB.Exec("UPDATE channels SET status = 2 WHERE id = ?", 321).Error)
	InitChannelCache()

	// A disabled line must not make the suffix parse: the pin would resolve to a
	// line with no usable channel, and the caller is better served by the name
	// passing through and failing on the model than by a silent reroute.
	_, _, pinned := SplitModelLineCode("default", autoRouteTestModel+"/hs10")
	assert.False(t, pinned)
}

func TestGetRandomSatisfiedChannelOnLine_PinSelectsTheNamedLine(t *testing.T) {
	cheap, dear := 0.44, 0.53
	// The pinned line is deliberately the dearer one: a pin must beat price
	// ranking, or naming a line would be advisory only.
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 331, priority: 10, discount: &dear, lineCode: "hs10"},
		{id: 332, priority: 10, discount: &cheap, lineCode: "tx8"},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	setAutoRoute(t, true)

	assert.Equal(t, map[int]int{331: 60}, selectedChannelIDsOnLine(t, 0, "hs10"),
		"pin must win over the cheaper unpinned line")
	assert.Equal(t, map[int]int{332: 60}, selectedChannelIDsOnLine(t, 0, "tx8"))
}

func TestGetRandomSatisfiedChannelOnLine_MissedPinFallsBack(t *testing.T) {
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 341, priority: 10, lineCode: "hs10"},
		{id: 342, priority: 10, lineCode: "tx8"},
	})

	// "ql8" is nobody's line here. The pin is a preference, so an unmatched one
	// degrades to automatic routing rather than failing the request — the customer
	// asked for a line, not for an error when that line is absent.
	counts := selectedChannelIDsOnLine(t, 0, "ql8")
	assert.Equal(t, 60, counts[341]+counts[342])
}

func TestGetRandomSatisfiedChannelOnLine_EmptyCodeIsUnchanged(t *testing.T) {
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 351, priority: 30, lineCode: "hs10"},
		{id: 352, priority: 10, lineCode: "tx8"},
	})

	// The unpinned path must be byte-for-byte the old behaviour: manual priority
	// decides, and the line codes are invisible to it.
	assert.Equal(t, map[int]int{351: 60}, selectedChannelIDsOnLine(t, 0, ""))
	assert.Equal(t, map[int]int{351: 60}, selectedChannelIDs(t, 0))
}
