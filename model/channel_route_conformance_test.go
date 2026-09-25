package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The conformance matrix: one scenario table, executed against both selection
// paths, asserting they agree.
//
// This exists because routing features kept landing on one path only. Line
// pinning shipped working on the cached path and 503'd on the database path;
// auto-route shipped working on the cached path and silently picked the
// expensive channel on the database path, with no error to notice. Both were
// possible because nothing forced the two implementations to be compared.
//
// A routing mode that only works on one path fails here. That is the point — the
// guarantee is structural, not a matter of remembering.

// selectVia runs one selection on the named path, returning the chosen channel id.
func selectVia(t *testing.T, path string, model string, retry int, lineCode string) int {
	t.Helper()
	switch path {
	case "cache":
		common.MemoryCacheEnabled = true
	case "db":
		common.MemoryCacheEnabled = false
	default:
		t.Fatalf("unknown path %q", path)
	}
	channel, err := GetRandomSatisfiedChannelOnLine("default", model, retry, "", lineCode)
	require.NoError(t, err)
	require.NotNil(t, channel, "path %s returned no channel", path)
	return channel.Id
}

// sampleVia samples one path repeatedly so a weighted-random tier shows up as a
// distribution rather than a single id.
func sampleVia(t *testing.T, path string, model string, retry int, lineCode string, n int) map[int]int {
	t.Helper()
	counts := make(map[int]int)
	for i := 0; i < n; i++ {
		counts[selectVia(t, path, model, retry, lineCode)]++
	}
	return counts
}

type routeScenario struct {
	name      string
	channels  []autoRouteChannelSpec
	autoRoute bool
	retry     int
	lineCode  string
	// want is the exact set of channel ids that may be selected. A single-entry
	// set asserts determinism; a multi-entry set asserts the tier is shared.
	want []int
}

func routeScenarios() []routeScenario {
	cheap, dear := 0.44, 0.53
	return []routeScenario{
		{
			name:     "manual priority wins with auto-route off",
			channels: []autoRouteChannelSpec{{id: 101, priority: 30, discount: &dear}, {id: 102, priority: 10, discount: &cheap}},
			want:     []int{101},
		},
		{
			name:     "retry walks to the next manual tier",
			channels: []autoRouteChannelSpec{{id: 101, priority: 30, discount: &dear}, {id: 102, priority: 10, discount: &cheap}},
			retry:    1,
			want:     []int{102},
		},
		{
			name:      "auto-route prefers the cheapest over manual priority",
			channels:  []autoRouteChannelSpec{{id: 101, priority: 30, discount: &dear}, {id: 102, priority: 10, discount: &cheap}},
			autoRoute: true,
			want:      []int{102},
		},
		{
			name:      "auto-route retry falls back to the dearer channel",
			channels:  []autoRouteChannelSpec{{id: 101, priority: 30, discount: &dear}, {id: 102, priority: 10, discount: &cheap}},
			autoRoute: true,
			retry:     1,
			want:      []int{101},
		},
		{
			name:      "equal prices share one tier",
			channels:  []autoRouteChannelSpec{{id: 101, priority: 30, discount: &cheap}, {id: 102, priority: 10, discount: &cheap}},
			autoRoute: true,
			want:      []int{101, 102},
		},
		{
			name:     "retry past the last tier stays on the last tier",
			channels: []autoRouteChannelSpec{{id: 101, priority: 30}, {id: 102, priority: 10}},
			retry:    7,
			want:     []int{102},
		},
		{
			name:     "equal manual priority shares one tier",
			channels: []autoRouteChannelSpec{{id: 101, priority: 20}, {id: 102, priority: 20}},
			want:     []int{101, 102},
		},
		{
			name:     "pinned line overrides manual priority",
			channels: []autoRouteChannelSpec{{id: 101, priority: 30, lineCode: "aa"}, {id: 102, priority: 10, lineCode: "bb"}},
			lineCode: "bb",
			want:     []int{102},
		},
		{
			name:      "pinned line overrides price ranking",
			channels:  []autoRouteChannelSpec{{id: 101, priority: 10, discount: &cheap, lineCode: "aa"}, {id: 102, priority: 10, discount: &dear, lineCode: "bb"}},
			autoRoute: true,
			lineCode:  "bb",
			want:      []int{102},
		},
		{
			name:     "unknown pin degrades to normal selection",
			channels: []autoRouteChannelSpec{{id: 101, priority: 30, lineCode: "aa"}, {id: 102, priority: 10, lineCode: "bb"}},
			lineCode: "zz",
			want:     []int{101},
		},
		{
			name:     "retry within a pinned line walks that line's own tiers",
			channels: []autoRouteChannelSpec{{id: 101, priority: 30, lineCode: "aa"}, {id: 102, priority: 20, lineCode: "bb"}, {id: 103, priority: 10, lineCode: "bb"}},
			lineCode: "bb",
			retry:    1,
			want:     []int{103},
		},
	}
}

// TestRouteConformance_BothPathsAgree is the regression gate. Every scenario runs
// on both paths and both must select from the same id set.
func TestRouteConformance_BothPathsAgree(t *testing.T) {
	for _, sc := range routeScenarios() {
		t.Run(sc.name, func(t *testing.T) {
			// autoRouteFixture forces the cache on and calls InitChannelCache,
			// which is also what populates the price rank table. The DB path reads
			// that same table, so ranks must be built before the switch flips.
			autoRouteFixture(t, sc.channels)
			withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
			// The rank map was built by the fixture's InitChannelCache, before the
			// official price existed. Rebuild so the fixture's prices are ranked.
			// That this is necessary at all is the coupling step 6 removes: rank
			// freshness should not depend on the channel cache being rebuilt.
			InitChannelCache()
			setAutoRoute(t, sc.autoRoute)
			t.Cleanup(func() { common.MemoryCacheEnabled = true })

			allowed := make(map[int]bool, len(sc.want))
			for _, id := range sc.want {
				allowed[id] = true
			}

			perPath := make(map[string]map[int]int)
			for _, path := range []string{"cache", "db"} {
				counts := sampleVia(t, path, autoRouteTestModel, sc.retry, sc.lineCode, 60)
				perPath[path] = counts
				for id := range counts {
					assert.True(t, allowed[id],
						"path %s selected channel %d, allowed set is %v", path, id, sc.want)
				}
				if len(sc.want) == 1 {
					assert.Equal(t, map[int]int{sc.want[0]: 60}, counts,
						"path %s must select channel %d deterministically", path, sc.want[0])
				}
			}

			// The agreement assertion proper: the two paths must reach the same
			// set of channels, not merely each stay inside the allowed set.
			assert.Equal(t, keysOf(perPath["cache"]), keysOf(perPath["db"]),
				"paths disagree: cache=%v db=%v", perPath["cache"], perPath["db"])
		})
	}
}

// TestRouteConformance_PriceRanksBuildWithCacheOff covers the coupling directly:
// the rank table must be populated by a refresh that never touches the channel
// cache. Without RefreshChannelPriceRanks this fails by selecting the dearer
// channel, which is exactly how price routing failed in production — silently,
// with a 200.
func TestRouteConformance_PriceRanksBuildWithCacheOff(t *testing.T) {
	cheap, dear := 0.44, 0.53
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 101, priority: 30, discount: &dear},
		{id: 102, priority: 10, discount: &cheap},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	setAutoRoute(t, true)
	t.Cleanup(func() { common.MemoryCacheEnabled = true })

	// Wipe the table the fixture populated, then rebuild it the way an install
	// with the cache off does: no InitChannelCache anywhere in this path.
	channelSyncLock.Lock()
	model2channelPriceRank = nil
	channelSyncLock.Unlock()
	RefreshChannelPriceRanks()

	common.MemoryCacheEnabled = false
	counts := sampleVia(t, "db", autoRouteTestModel, 0, "", 40)
	assert.Equal(t, map[int]int{102: 40}, counts,
		"cheapest channel must win with the cache off and no cache rebuild")
}

func keysOf(counts map[int]int) string {
	ids := make([]int, 0, len(counts))
	for id := range counts {
		ids = append(ids, id)
	}
	sortInts(ids)
	return fmt.Sprint(ids)
}

func sortInts(ids []int) {
	for i := 1; i < len(ids); i++ {
		for j := i; j > 0 && ids[j-1] > ids[j]; j-- {
			ids[j-1], ids[j] = ids[j], ids[j-1]
		}
	}
}
