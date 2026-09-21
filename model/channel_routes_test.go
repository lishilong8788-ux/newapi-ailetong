package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetModelChannelRoutes_CheapestFirstAndUnpricedLast(t *testing.T) {
	cheap, dear := 0.44, 0.53
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 201, priority: 30, discount: &dear},
		{id: 202, priority: 20},
		{id: 203, priority: 10, discount: &cheap},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	InitChannelCache()

	routes := GetModelChannelRoutes(autoRouteTestModel, []string{"default"})
	require.Len(t, routes, 3)

	assert.Equal(t, []int{203, 201, 202}, []int{routes[0].ChannelID, routes[1].ChannelID, routes[2].ChannelID},
		"cheapest first, and the channel with no resolvable price last regardless of its manual priority")

	// 官网价 10 × 4.4折 = 4.4；折扣要原样带出来，前端的折扣徽章读它
	assert.InDelta(t, 4.4, routes[0].Price.ModelRatio, 1e-9)
	require.NotNil(t, routes[0].Price.Discount)
	assert.InDelta(t, 0.44, *routes[0].Price.Discount, 1e-9)
	assert.Equal(t, "channel", routes[0].Price.Source)

	// The unpriced row must not claim a discount, and must be labelled fallback so
	// the card renders the platform price without a discount badge.
	assert.Nil(t, routes[2].Price.Discount)
	assert.Equal(t, "fallback", routes[2].Price.Source)
}

func TestGetModelChannelRoutes_ExcludesUnreachableGroups(t *testing.T) {
	discount := 0.44
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 204, priority: 10, discount: &discount},
	})
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	InitChannelCache()

	// The fixture puts every channel in "default" only. A viewer who can only
	// reach "vip" must be told about nothing — the endpoint is public, and the
	// existence of a private line is itself information.
	assert.Empty(t, GetModelChannelRoutes(autoRouteTestModel, []string{"vip"}))
	assert.Len(t, GetModelChannelRoutes(autoRouteTestModel, []string{"default", "vip"}), 1)
}

func TestGetModelChannelRoutes_PerCallModelRowsArePricedAndOrderedManually(t *testing.T) {
	cheap, dear := 0.44, 0.90
	autoRouteFixture(t, []autoRouteChannelSpec{
		{id: 205, priority: 10, discount: &cheap},
		{id: 206, priority: 30, discount: &dear},
	})
	withPerCallPrice(t, autoRouteTestModel, 0.04)
	withOfficialPrice(t, autoRouteTestModel, testOfficialRatio)
	InitChannelCache()

	routes := GetModelChannelRoutes(autoRouteTestModel, []string{"default"})
	require.Len(t, routes, 2)

	for _, route := range routes {
		assert.False(t, route.Price.PriceUnset,
			"每条线路都报同一个按次价，卡片不该显示价格未设置")
		assert.Equal(t, quotaTypePerRequest, route.Price.QuotaType)
		assert.Equal(t, 0.04, route.Price.ModelPrice)
	}

	// No comparable ratio means no cheapest row to promote, so the order is the
	// operator's manual priority — the same order the router itself falls back to.
	assert.Equal(t, []int{206, 205}, []int{routes[0].ChannelID, routes[1].ChannelID})
}

func TestLineCodeOf(t *testing.T) {
	cases := []struct {
		name          string
		clientModel   string
		upstreamModel string
		want          string
	}{
		{
			name:          "mapping suffix is the line code",
			clientModel:   "deepseek-v4-pro-0813",
			upstreamModel: "deepseek-v4-pro-0813/hs4",
			want:          "hs4",
		},
		{
			name:          "unmapped model has no line",
			clientModel:   "deepseek-v4-pro-0813",
			upstreamModel: "deepseek-v4-pro-0813",
			want:          "",
		},
		{
			// A vendor-namespaced name is not a line: "qwen3" would be a
			// nonsensical label for the channel.
			name:          "vendor namespace is not a line code",
			clientModel:   "qwen3",
			upstreamModel: "qwen/qwen3",
			want:          "",
		},
		{
			name:          "rename without the original prefix is not a line",
			clientModel:   "gpt-4o",
			upstreamModel: "azure/gpt-4o-2024",
			want:          "",
		},
		{
			name:          "trailing slash yields nothing",
			clientModel:   "gpt-4o",
			upstreamModel: "gpt-4o/",
			want:          "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, lineCodeOf(tc.clientModel, tc.upstreamModel))
		})
	}
}

func TestResolveUpstreamModel_FollowsChainAndSurvivesCycles(t *testing.T) {
	cases := []struct {
		name        string
		mapping     map[string]string
		clientModel string
		want        string
	}{
		{
			name:        "no mapping",
			mapping:     nil,
			clientModel: "m",
			want:        "m",
		},
		{
			name:        "single hop",
			mapping:     map[string]string{"m": "m/hs4"},
			clientModel: "m",
			want:        "m/hs4",
		},
		{
			name:        "chained redirect ends at the tail",
			mapping:     map[string]string{"m": "n", "n": "o"},
			clientModel: "m",
			want:        "o",
		},
		{
			name:        "self-mapping is a no-op, not a cycle error",
			mapping:     map[string]string{"m": "m"},
			clientModel: "m",
			want:        "m",
		},
		{
			// The relay rejects this request outright; pricing the advertised name
			// beats pricing a name we know cannot be reached.
			name:        "true cycle falls back to the client name",
			mapping:     map[string]string{"m": "n", "n": "m"},
			clientModel: "m",
			want:        "m",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, resolveUpstreamModel(tc.mapping, tc.clientModel))
		})
	}
}
