package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// costChannel is a channel priced the way the drawer writes it: one buy price
// per upstream model plus a channel-level markup.
func costChannel(id int, models string, markup float64, prices map[string]dto.ModelCostPrice) *Channel {
	channel := &Channel{
		Id:     id,
		Status: common.ChannelStatusEnabled,
		Models: models,
	}
	channel.SetOtherSettings(dto.ChannelOtherSettings{
		Cost: &dto.ChannelCostSettings{DefaultMarkup: &markup, Models: prices},
	})
	return channel
}

func usd(v float64) *float64 { return &v }

// The four production lines, in CNY/M converted at 7.3 to the USD/M the config
// stores. Each publishes its own sell price: one price per line, not one price
// per site, so the cheapest supplier is the cheapest row.
func TestResolveChannelPrice_EachChannelPublishesItsOwnSellPrice(t *testing.T) {
	const modelName = "test-cost-model"
	const markup = 0.2

	// Ratio 1 == $2/M (QuotaPerUnit 500000), so a $1.0/M buy price marked up 20%
	// is $1.2/M, which is ratio 0.6.
	cases := []struct {
		name          string
		inputUSD      float64
		expectedRatio float64
	}{
		{name: "cheapest line", inputUSD: 1.0, expectedRatio: 0.6},
		{name: "dearest line", inputUSD: 2.0, expectedRatio: 1.2},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			meta := parseChannelPriceMetadata(costChannel(1, modelName, markup,
				map[string]dto.ModelCostPrice{
					modelName: {Input: usd(tc.inputUSD), Output: usd(tc.inputUSD * 4)},
				}))
			require.NotNil(t, meta.cost)

			resolved := resolveChannelPrice(meta, modelName)

			assert.Equal(t, dto.PriceSourceCost, resolved.Source)
			// 进价 × 1.2, then USD/M -> ratio.
			assert.InDelta(t, tc.expectedRatio, resolved.ModelRatio, 1e-9)
			require.NotNil(t, resolved.CompletionRatio)
			assert.InDelta(t, 4.0, *resolved.CompletionRatio, 1e-9)
			// Nobody configured a discount; the catalog derives the ratio against
			// the vendor list price itself.
			assert.Nil(t, resolved.Discount)
			assert.False(t, resolved.PriceUnset)
			// A sell price is a complete price, so the row must not be flagged as
			// unpriced just because the platform has no ratio for the model.
			assert.True(t, resolved.Comparable())
		})
	}
}

// A 0% markup is "sell at cost", a configured price — not an absent one. This is
// the whole chain the form bug broke: no default_markup in the JSON meant no sell
// price at all, and the channel silently kept billing the legacy ratio.
func TestResolveChannelPrice_ZeroMarkupSellsAtCost(t *testing.T) {
	const modelName = "test-cost-model"

	meta := parseChannelPriceMetadata(costChannel(1, modelName, 0,
		map[string]dto.ModelCostPrice{modelName: {Input: usd(1.0)}}))

	resolved := resolveChannelPrice(meta, modelName)

	assert.Equal(t, dto.PriceSourceCost, resolved.Source)
	assert.InDelta(t, 0.5, resolved.ModelRatio, 1e-9) // $1.0/M sold at cost
}

// Buy prices order the router, which is the point of ranking at all: with each
// line priced off its own cost, cheapest-first routing hands the customer the
// lowest of the four sell prices while every line keeps its own markup.
func TestBuildChannelPriceRanks_RanksOnBuyPrice(t *testing.T) {
	const modelName = "test-cost-model"
	const markup = 0.2

	ranks := buildRanksFor(t,
		costChannel(1, modelName, markup, map[string]dto.ModelCostPrice{
			modelName: {Input: usd(1.85 / 7.3)}, // jd6
		}),
		costChannel(2, modelName, markup, map[string]dto.ModelCostPrice{
			modelName: {Input: usd(0.959999 / 7.3)}, // xy
		}),
		costChannel(3, modelName, markup, map[string]dto.ModelCostPrice{
			modelName: {Input: usd(1.28 / 7.3)}, // hs5
		}),
	)

	modelRanks, ok := ranks[modelName]
	require.True(t, ok, "three distinct buy prices must produce a ranking")
	assert.Equal(t, int64(3), modelRanks[2], "cheapest buy price must rank highest")
	assert.Equal(t, int64(2), modelRanks[3])
	assert.Equal(t, int64(1), modelRanks[1], "dearest buy price must rank lowest")
}

// An unpriced channel must never be reached before a priced one: "cheapest first"
// cannot mean "unknown first".
func TestBuildChannelPriceRanks_UnpricedChannelSinksBelowCostPriced(t *testing.T) {
	const modelName = "test-cost-model"

	ranks := buildRanksFor(t,
		costChannel(1, modelName, 0.2, map[string]dto.ModelCostPrice{
			modelName: {Input: usd(1.0)},
		}),
		costChannel(2, modelName, 0.2, nil), // markup configured, no buy price
	)

	modelRanks, ok := ranks[modelName]
	require.True(t, ok, "one priced plus one unpriced channel is a real ordering decision")
	assert.Greater(t, modelRanks[1], priceRankUnresolved)
	assert.Equal(t, priceRankUnresolved, modelRanks[2])
}

// A per-call model is billed by ModelPriceHelper's per-call path, which never
// consults a buy price, so the card must not publish one either.
func TestResolveChannelPrice_PerCallPriceShadowsSellPrice(t *testing.T) {
	const modelName = "test-per-call-model"
	withPerCallPrice(t, modelName, 0.04)

	meta := parseChannelPriceMetadata(costChannel(1, modelName, 0.2,
		map[string]dto.ModelCostPrice{modelName: {Input: usd(1.0)}}))

	resolved := resolveChannelPrice(meta, modelName)

	assert.Equal(t, dto.PriceSourceFallback, resolved.Source)
	assert.Equal(t, quotaTypePerRequest, resolved.QuotaType)
	assert.Equal(t, 0.04, resolved.ModelPrice)
	assert.Zero(t, resolved.ModelRatio)
	assert.False(t, resolved.Comparable(), "a per-call price is not comparable with a token ratio")
}

// The buy price is keyed on the UPSTREAM name, because that is what we pay the
// vendor for. applyChannelSellPrice walks the same mapping before looking it up,
// so a channel that remaps must resolve the same price on both sides.
func TestResolveChannelPrice_BuyPriceKeyedOnUpstreamName(t *testing.T) {
	const clientModel = "deepseek-v4-flash"
	const upstreamModel = "deepseek-v4-flash-0731"

	channel := costChannel(1, clientModel, 0.2, map[string]dto.ModelCostPrice{
		upstreamModel: {Input: usd(1.0)},
	})
	mapping := `{"` + clientModel + `":"` + upstreamModel + `"}`
	channel.ModelMapping = &mapping

	resolved := resolveChannelPrice(parseChannelPriceMetadata(channel), clientModel)

	assert.Equal(t, upstreamModel, resolved.UpstreamModel)
	assert.Equal(t, dto.PriceSourceCost, resolved.Source)
	assert.InDelta(t, 0.6, resolved.ModelRatio, 1e-9)
}

// The sell price is what bills, so it must win over a discount configured on the
// same channel — publishing the discount while billing the sell price is exactly
// the split between the catalog and the invoice this wiring exists to close.
func TestResolveChannelPrice_SellPriceWinsOverDiscount(t *testing.T) {
	const modelName = "test-cost-model"
	withOfficialPrice(t, modelName, testOfficialRatio)

	discount := 0.44
	channel := costChannel(1, modelName, 0.2, map[string]dto.ModelCostPrice{
		modelName: {Input: usd(1.0)},
	})
	channel.SetOtherSettings(dto.ChannelOtherSettings{
		Cost:  &dto.ChannelCostSettings{DefaultMarkup: usd(0.2), Models: map[string]dto.ModelCostPrice{modelName: {Input: usd(1.0)}}},
		Price: &dto.ChannelPriceSettings{Discount: &discount},
	})

	resolved := resolveChannelPrice(parseChannelPriceMetadata(channel), modelName)

	assert.Equal(t, dto.PriceSourceCost, resolved.Source)
	assert.InDelta(t, 0.6, resolved.ModelRatio, 1e-9, "must be cost x 1.2, not official x 0.44")
	assert.Nil(t, resolved.Discount)
}
