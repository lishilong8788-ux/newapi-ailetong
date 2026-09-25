package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The official list price the discounts below are applied to. Picked so every
// expected sell ratio stays exact in float64.
const testOfficialRatio = 10.0

func withOfficialPrice(t *testing.T, modelName string, ratio float64) {
	t.Helper()
	payload, err := common.Marshal(map[string]float64{modelName: ratio})
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateOfficialModelRatioByJSONString(string(payload)))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateOfficialModelRatioByJSONString(""))
	})
}

// withPerCallPrice registers an absolute per-request price (USD per call), the
// ModelPrice map billing consults before it ever looks at a ratio.
func withPerCallPrice(t *testing.T, modelName string, price float64) {
	t.Helper()
	payload, err := common.Marshal(map[string]float64{modelName: price})
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(string(payload)))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString("{}"))
	})
}

func priceChannel(id int, models string, discount *float64, mapping string) *Channel {
	channel := &Channel{
		Id:     id,
		Status: common.ChannelStatusEnabled,
		Models: models,
	}
	if mapping != "" {
		channel.ModelMapping = &mapping
	}
	if discount != nil {
		channel.SetOtherSettings(dto.ChannelOtherSettings{
			Price: &dto.ChannelPriceSettings{Discount: discount},
		})
	}
	return channel
}

func buildRanksFor(t *testing.T, channels ...*Channel) map[string]map[int]int64 {
	t.Helper()
	metadata := make(map[int]channelPriceMetadata)
	for _, channel := range channels {
		metadata[channel.Id] = parseChannelPriceMetadata(channel)
	}
	return buildChannelPriceRanks(channels, metadata)
}

func TestBuildChannelPriceRanks_CheapestRanksHighest(t *testing.T) {
	const modelName = "test-rank-model"
	withOfficialPrice(t, modelName, testOfficialRatio)

	cheap, mid, dear := 0.44, 0.50, 0.53
	ranks := buildRanksFor(t,
		priceChannel(1, modelName, &dear, ""),
		priceChannel(2, modelName, &cheap, ""),
		priceChannel(3, modelName, &mid, ""),
	)

	modelRanks, ok := ranks[modelName]
	require.True(t, ok, "a model with three distinct discounts must be ranked")
	// Descending rank == ascending price: GetRandomSatisfiedChannel sorts
	// priorities descending and retry walks down one tier at a time.
	assert.Equal(t, int64(3), modelRanks[2], "4.4折 is cheapest, must rank highest")
	assert.Equal(t, int64(2), modelRanks[3])
	assert.Equal(t, int64(1), modelRanks[1], "5.3折 is dearest, must rank lowest")
}

func TestBuildChannelPriceRanks_UnpricedChannelsRankBelowPriced(t *testing.T) {
	const modelName = "test-rank-model"
	withOfficialPrice(t, modelName, testOfficialRatio)

	discount := 0.44
	ranks := buildRanksFor(t,
		priceChannel(1, modelName, nil, ""),
		priceChannel(2, modelName, &discount, ""),
	)

	modelRanks, ok := ranks[modelName]
	require.True(t, ok, "one priced plus one unpriced channel is a real ordering decision")
	assert.Greater(t, modelRanks[2], modelRanks[1],
		"a channel whose price cannot be resolved must never outrank a priced one")
	assert.Equal(t, priceRankUnresolved, modelRanks[1])
}

func TestBuildChannelPriceRanks_NoDiscountsConfiguredIsNotRanked(t *testing.T) {
	const modelName = "test-rank-model"
	withOfficialPrice(t, modelName, testOfficialRatio)

	// The production state before an operator configures anything. Ranking here
	// would flatten every manual priority tier into one and silently convert
	// failover into a single weighted pool.
	ranks := buildRanksFor(t,
		priceChannel(1, modelName, nil, ""),
		priceChannel(2, modelName, nil, ""),
		priceChannel(3, modelName, nil, ""),
	)

	_, ok := ranks[modelName]
	assert.False(t, ok, "no channel has a discount, so there is no price spread to route on")
}

func TestBuildChannelPriceRanks_IdenticalDiscountsShareOneTier(t *testing.T) {
	const modelName = "test-rank-model"
	withOfficialPrice(t, modelName, testOfficialRatio)

	same1, same2 := 0.44, 0.44
	ranks := buildRanksFor(t,
		priceChannel(1, modelName, &same1, ""),
		priceChannel(2, modelName, &same2, ""),
	)

	_, ok := ranks[modelName]
	assert.False(t, ok,
		"equal prices are one tier; two channels at the same discount must load-balance, not fail over")
}

func TestBuildChannelPriceRanks_DiscountWithoutOfficialPriceIsUnresolved(t *testing.T) {
	const modelName = "test-rank-unpriced-model"
	// No official price registered: a discount has nothing to apply to.
	discount := 0.44
	other := 0.90
	ranks := buildRanksFor(t,
		priceChannel(1, modelName, &discount, ""),
		priceChannel(2, modelName, &other, ""),
	)

	_, ok := ranks[modelName]
	assert.False(t, ok,
		"without a list price the discounts produce no comparable number, so the model stays unranked")
}

func TestResolveChannelPrice_PerCallModelIsPricedNotUnset(t *testing.T) {
	cases := []struct {
		name  string
		price float64
	}{
		// dall-e-3 的形态：一次调用一个绝对美元价，没有任何 token 倍率。
		{name: "paid per call", price: 0.04},
		// mj_inpaint ships configured at 0. A free call is a price the operator
		// set, and reporting it unset would render `-` for a priced row.
		{name: "free per call", price: 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			const modelName = "test-per-call-model"
			withPerCallPrice(t, modelName, tc.price)

			resolved := resolveChannelPrice(channelPriceMetadata{}, modelName)

			assert.False(t, resolved.PriceUnset,
				"the model has a configured per-call price, so the card must not print `价格未设置`")
			assert.Equal(t, quotaTypePerRequest, resolved.QuotaType)
			assert.Equal(t, tc.price, resolved.ModelPrice)
			// No token rate exists for a per-call model; publishing one would be
			// the 37.5 fallback constant dressed up as a price.
			assert.Zero(t, resolved.ModelRatio)
			assert.Nil(t, resolved.CompletionRatio)
		})
	}
}

func TestResolveChannelPrice_PerCallPriceBeatsDiscountedListPrice(t *testing.T) {
	const modelName = "test-per-call-model"
	withPerCallPrice(t, modelName, 0.04)
	// Both a channel discount and an official token list price exist, so the
	// discount branch would happily produce 10 × 0.44. Billing never charges it:
	// ModelPriceHelper hits GetModelPrice first and never reads a ratio.
	withOfficialPrice(t, modelName, testOfficialRatio)
	discount := 0.44

	resolved := resolveChannelPrice(
		channelPriceMetadata{price: &dto.ChannelPriceSettings{Discount: &discount}},
		modelName,
	)

	assert.Equal(t, quotaTypePerRequest, resolved.QuotaType)
	assert.Equal(t, 0.04, resolved.ModelPrice)
	assert.Zero(t, resolved.ModelRatio, "a discount on a token list price is not what a per-call request is billed")
	assert.Nil(t, resolved.Discount, "no badge: the discount scaled nothing on this row")
	assert.Equal(t, dto.PriceSourceFallback, resolved.Source)
}

func TestBuildChannelPriceRanks_PerCallModelIsNotRanked(t *testing.T) {
	const modelName = "test-per-call-model"
	withPerCallPrice(t, modelName, 0.04)
	withOfficialPrice(t, modelName, testOfficialRatio)

	// Two different discounts, which on a token-priced model would be two tiers.
	cheap, dear := 0.44, 0.90
	ranks := buildRanksFor(t,
		priceChannel(1, modelName, &dear, ""),
		priceChannel(2, modelName, &cheap, ""),
	)

	_, ok := ranks[modelName]
	assert.False(t, ok,
		"USD per call and a per-token ratio are different units; ordering them would compare $0.04 against a ratio")
}

func TestBuildChannelPriceRanks_ModelMappingPricesTheUpstreamName(t *testing.T) {
	const clientModel = "test-rank-model"
	const upstreamModel = "test-rank-model/hs4"
	withOfficialPrice(t, upstreamModel, testOfficialRatio)

	// Per-model override keyed on the UPSTREAM name, which is the key space
	// ChannelPriceSettings.Models uses.
	channelDiscount, modelDiscount := 0.90, 0.44
	mapped := priceChannel(1, clientModel, &channelDiscount, `{"`+clientModel+`":"`+upstreamModel+`"}`)
	mapped.SetOtherSettings(dto.ChannelOtherSettings{
		Price: &dto.ChannelPriceSettings{
			Discount: &channelDiscount,
			Models:   map[string]*float64{upstreamModel: &modelDiscount},
		},
	})
	plain := priceChannel(2, clientModel, &channelDiscount, "")

	ranks := buildRanksFor(t, mapped, plain)

	modelRanks, ok := ranks[clientModel]
	require.True(t, ok)
	// The mapped channel resolves 4.4折 off the upstream list price; the plain one
	// has no list price for the bare name at all, so it sinks to the bottom tier.
	assert.Greater(t, modelRanks[1], modelRanks[2])
	assert.Equal(t, priceRankUnresolved, modelRanks[2])
}
