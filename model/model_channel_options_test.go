package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// modelChannelOptionSpec is one (group, model, channel) reachability row plus the
// channel fields the picker renders.
type modelChannelOptionSpec struct {
	group        string
	modelName    string
	channelId    int
	channelName  string
	lineCode     string
	channelType  int
	statusDisbld bool
}

// modelChannelOptionsFixture seeds abilities + channels and returns with the
// memory cache in the requested state, so both selection paths can be asserted
// against the same data.
func modelChannelOptionsFixture(t *testing.T, cached bool, specs []modelChannelOptionSpec) {
	t.Helper()
	originalMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = cached
	require.NoError(t, DB.AutoMigrate(&Channel{}, &Ability{}))
	for _, table := range []string{"abilities", "channels"} {
		require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
	}

	seeded := make(map[int]bool)
	for _, spec := range specs {
		if !seeded[spec.channelId] {
			status := common.ChannelStatusEnabled
			if spec.statusDisbld {
				status = common.ChannelStatusManuallyDisabled
			}
			channel := &Channel{
				Id:     spec.channelId,
				Type:   spec.channelType,
				Key:    "k",
				Status: status,
				Name:   spec.channelName,
				Models: spec.modelName,
				Group:  spec.group,
			}
			if spec.lineCode != "" {
				lineCode := spec.lineCode
				channel.LineCode = &lineCode
			}
			require.NoError(t, DB.Create(channel).Error)
			seeded[spec.channelId] = true
		}
		require.NoError(t, DB.Create(&Ability{
			Group:     spec.group,
			Model:     spec.modelName,
			ChannelId: spec.channelId,
			// A disabled channel's abilities are disabled with it, which is what
			// keeps it out of the options without a second status check.
			Enabled: !spec.statusDisbld,
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

// The picker offers "model + the channels that serve it", so the contract is:
// one entry per model, its channels deduped across groups, both orders stable.
// Cached and DB paths must agree — an operator with the memory cache off would
// otherwise get an empty picker and no way to configure the copilot at all.
func TestGetModelChannelOptions(t *testing.T) {
	specs := []modelChannelOptionSpec{
		{group: "default", modelName: "gpt-5", channelId: 11, channelName: "azure", lineCode: "az1", channelType: 3},
		// Same channel reachable in two groups: one entry, not two.
		{group: "vip", modelName: "gpt-5", channelId: 11, channelName: "azure", lineCode: "az1", channelType: 3},
		{group: "default", modelName: "gpt-5", channelId: 9, channelName: "openai", channelType: 1},
		{group: "default", modelName: "claude-4", channelId: 12, channelName: "anthropic", channelType: 14},
		// Out of reach for the groups asked about.
		{group: "private", modelName: "secret-model", channelId: 20, channelName: "private", channelType: 1},
	}

	for _, cached := range []bool{true, false} {
		name := "memory cache on"
		if !cached {
			name = "memory cache off"
		}
		t.Run(name, func(t *testing.T) {
			modelChannelOptionsFixture(t, cached, specs)

			options := GetModelChannelOptions([]string{"default", "vip"})
			require.Len(t, options, 2)

			assert.Equal(t, "claude-4", options[0].Model, "models ascending")
			assert.Equal(t, "gpt-5", options[1].Model)

			require.Len(t, options[0].Channels, 1)
			assert.Equal(t, ModelChannelChoice{ChannelId: 12, Name: "anthropic", Type: 14}, options[0].Channels[0])

			require.Len(t, options[1].Channels, 2, "one entry per channel even when reachable in two groups")
			assert.Equal(t, ModelChannelChoice{ChannelId: 9, Name: "openai", Type: 1}, options[1].Channels[0],
				"channels by id, and a channel with no line code reports none")
			assert.Equal(t, ModelChannelChoice{ChannelId: 11, Name: "azure", Code: "az1", Type: 3}, options[1].Channels[1])
		})
	}
}

// A model whose only channel is disabled must not be offered: picking it would
// produce a copilot that fails on its first message with "no available channel".
func TestGetModelChannelOptionsSkipsDisabledChannels(t *testing.T) {
	for _, cached := range []bool{true, false} {
		name := "memory cache on"
		if !cached {
			name = "memory cache off"
		}
		t.Run(name, func(t *testing.T) {
			modelChannelOptionsFixture(t, cached, []modelChannelOptionSpec{
				{group: "default", modelName: "gpt-5", channelId: 30, channelName: "down", channelType: 1, statusDisbld: true},
				{group: "default", modelName: "claude-4", channelId: 31, channelName: "up", channelType: 14},
			})

			options := GetModelChannelOptions([]string{"default"})
			require.Len(t, options, 1)
			assert.Equal(t, "claude-4", options[0].Model)
		})
	}
}

// No groups means no reachable models. Returning everything here would offer the
// copilot models its own group cannot route.
func TestGetModelChannelOptionsWithoutGroups(t *testing.T) {
	modelChannelOptionsFixture(t, true, []modelChannelOptionSpec{
		{group: "default", modelName: "gpt-5", channelId: 40, channelName: "openai", channelType: 1},
	})

	assert.Empty(t, GetModelChannelOptions(nil))
	assert.Empty(t, GetModelChannelOptions([]string{"nonexistent"}))
}
