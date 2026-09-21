package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/route_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const autoRouteTestModel = "auto-route-test-model"

func setAutoRoute(t *testing.T, enabled bool) {
	t.Helper()
	// Through the option path rather than by poking the struct, so the test also
	// covers the setting being registered under a name UpdateOption can reach.
	value := "false"
	if enabled {
		value = "true"
	}
	require.NoError(t, config.UpdateConfigFromMap(route_setting.GetRouteSetting(), map[string]string{
		"auto_route_enabled": value,
	}))
	t.Cleanup(func() {
		require.NoError(t, config.UpdateConfigFromMap(route_setting.GetRouteSetting(), map[string]string{
			"auto_route_enabled": "false",
		}))
	})
}

// autoRouteFixture installs channels with the given (priority, discount) pairs,
// all serving autoRouteTestModel in group "default", and rebuilds the cache.
func autoRouteFixture(t *testing.T, specs []autoRouteChannelSpec) {
	t.Helper()
	originalMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	require.NoError(t, DB.AutoMigrate(&Channel{}, &Ability{}))
	for _, table := range []string{"abilities", "channels"} {
		require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
	}

	for _, spec := range specs {
		priority := spec.priority
		channel := &Channel{
			Id:       spec.id,
			Type:     1,
			Key:      "k",
			Status:   common.ChannelStatusEnabled,
			Name:     "channel",
			Models:   autoRouteTestModel,
			Group:    "default",
			Priority: &priority,
		}
		if spec.discount != nil {
			discount := *spec.discount
			channel.SetOtherSettings(dto.ChannelOtherSettings{
				Price: &dto.ChannelPriceSettings{Discount: &discount},
			})
		}
		require.NoError(t, DB.Create(channel).Error)
		require.NoError(t, DB.Create(&Ability{
			Group:     "default",
			Model:     autoRouteTestModel,
			ChannelId: spec.id,
			Enabled:   true,
			Priority:  &priority,
		}).Error)
	}

	InitChannelCache()
	t.Cleanup(func() {
		for _, table := range []string{"abilities", "channels"} {
			require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
		}
		InitChannelCache()
		common.MemoryCacheEnabled = originalMemoryCache
	})
}

type autoRouteChannelSpec struct {
	id       int
	priority int64
	discount *float64
}

// selectedChannelIDs samples selection many times for one retry level, so a
// weighted-random tier shows up as more than one id.
func selectedChannelIDs(t *testing.T, retry int) map[int]int {
	t.Helper()
	counts := make(map[int]int)
	for i := 0; i < 60; i++ {
		channel, err := GetRandomSatisfiedChannel("default", autoRouteTestModel, retry, "")
		require.NoError(t, err)
		require.NotNil(t, channel)
		counts[channel.Id]++
	}
	return counts
}

func TestGetRandomSatisfiedChannel_AutoRouteOffKeepsManualPriority(t *testing.T) {
	cheap, dear := 0.44, 0.53
	// Manual priority deliberately contradicts price: the dearest channel is the
	// operator's first choice. With the switch off that must still win.
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 101, priority: 30, discount: &dear},
		{id: 102, priority: 10, discount: &cheap},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	setAutoRoute(t, false)

	assert.Equal(t, map[int]int{101: 60}, selectedChannelIDs(t, 0),
		"switch off must select by manual priority, not by price")
	assert.Equal(t, map[int]int{102: 60}, selectedChannelIDs(t, 1),
		"retry still walks down the manual priority tiers")
}

func TestGetRandomSatisfiedChannel_AutoRouteOnPrefersCheapest(t *testing.T) {
	cheap, dear := 0.44, 0.53
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 101, priority: 30, discount: &dear},
		{id: 102, priority: 10, discount: &cheap},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	// The rank map is built by InitChannelCache, which ran before the official
	// price existed; rebuild so the fixture's prices are the ones ranked.
	InitChannelCache()
	setAutoRoute(t, true)

	assert.Equal(t, map[int]int{102: 60}, selectedChannelIDs(t, 0),
		"4.4折 must be reached first even though its manual priority is lower")
	assert.Equal(t, map[int]int{101: 60}, selectedChannelIDs(t, 1),
		"retry 1 falls through to the next price tier")
}

func TestGetRandomSatisfiedChannel_AutoRouteOnWithNoDiscountsKeepsManualPriority(t *testing.T) {
	// The state a fresh upgrade lands in: switch on, nothing configured.
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 101, priority: 30},
		{id: 102, priority: 10},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	InitChannelCache()
	setAutoRoute(t, true)

	assert.Equal(t, map[int]int{101: 60}, selectedChannelIDs(t, 0),
		"no price spread means the manual priority tiers must survive intact")
	assert.Equal(t, map[int]int{102: 60}, selectedChannelIDs(t, 1))
}

func TestGetRandomSatisfiedChannel_AutoRouteOnSinksUnpricedChannels(t *testing.T) {
	cheap := 0.44
	autoRouteFixture(t, []autoRouteChannelSpec{
		// Highest manual priority, no resolvable price.
		{id: 101, priority: 30},
		{id: 102, priority: 10, discount: &cheap},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	InitChannelCache()
	setAutoRoute(t, true)

	assert.Equal(t, map[int]int{102: 60}, selectedChannelIDs(t, 0),
		"a priced channel must be reached before one whose price is unknown")
	assert.Equal(t, map[int]int{101: 60}, selectedChannelIDs(t, 1),
		"the unpriced channel is still reachable, just last")
}

func TestGetRandomSatisfiedChannel_AutoRouteOnEqualPricesShareOneTier(t *testing.T) {
	same := 0.44
	other := same
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 101, priority: 10, discount: &same},
		{id: 102, priority: 10, discount: &other},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	InitChannelCache()
	setAutoRoute(t, true)

	counts := selectedChannelIDs(t, 0)
	assert.Len(t, counts, 2,
		"equal prices must load-balance across both channels, not pick a primary")
}

func TestGetRandomSatisfiedChannel_AutoRouteOnRetryBeyondTiersStaysOnLast(t *testing.T) {
	cheap, dear := 0.44, 0.53
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 101, priority: 30, discount: &dear},
		{id: 102, priority: 10, discount: &cheap},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	InitChannelCache()
	setAutoRoute(t, true)

	// Same clamp the manual path has: retry past the tier count must not index
	// out of range, it settles on the dearest tier.
	assert.Equal(t, map[int]int{101: 60}, selectedChannelIDs(t, 5))
}
