package service

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
)

// The unit tests all exercise one function at a time. This one walks the shape a
// real settlement produces: channel settings in, one log `other` map out,
// carrying both sides of the margin. It is the closest thing to an end-to-end
// check that runs without a channel, an upstream, or a database — a miswired
// call site is otherwise invisible until production.
func TestSnapshotWiring_CostAndPriceLandTogether(t *testing.T) {
	seedOfficialRatios(t, `{"wiring-fixture":2}`, `{"wiring-fixture":3}`, `{}`)

	// Cost side: the channel pays list price less 30%. Price side: we resell at
	// 4.4折 off list. Both are per-channel settings on the same channel.
	costSettings := &dto.ChannelCostSettings{
		Models: map[string]dto.ModelCostPrice{
			"wiring-fixture": {Input: f64(1.4), Output: f64(4.2)},
		},
	}
	priceSettings := &dto.ChannelPriceSettings{Discount: ptr(0.44)}

	tokens := CostTokenBreakdown{PromptTokens: 1000, CompletionTokens: 500}
	// List price: (1000 + 500x3) x 2 = 5000 quota.
	listQuota, complete := ComputeListPriceQuota("wiring-fixture", tokens)
	if listQuota != 5000 || !complete {
		t.Fatalf("list price = (%d, %v), want (5000, true)", listQuota, complete)
	}
	charged := 5000 // what the legacy path happened to bill

	other := map[string]interface{}{}
	costQuota, costSource := ComputeUpstreamCost(costSettings, "wiring-fixture", CostInputs{
		Tokens: tokens, Revenue: charged,
	})
	writeCostSnapshotForTest(other, costQuota, costSource)
	writeSellPriceSnapshot(priceSettings, "wiring-fixture", charged, tokens, other)

	admin, ok := other["admin_info"].(map[string]interface{})
	if !ok {
		t.Fatal("admin_info missing: snapshots are admin-only and must nest under it")
	}

	price, ok := admin["price"].(map[string]interface{})
	if !ok {
		t.Fatal("price snapshot missing")
	}
	if price["list_quota"] != 5000 {
		t.Errorf("list_quota = %v, want 5000", price["list_quota"])
	}
	// 5000 x 0.44 = 2200: what the configured discount says this should cost.
	if price["expected_quota"] != 2200 {
		t.Errorf("expected_quota = %v, want 2200", price["expected_quota"])
	}
	if price["charged_quota"] != 5000 {
		t.Errorf("charged_quota = %v, want 5000", price["charged_quota"])
	}
	if price["price_source"] != PriceSourceChannel {
		t.Errorf("price_source = %v, want channel", price["price_source"])
	}

	// The gap between expected and charged is the whole point of the snapshot
	// stage: it is the evidence that the discount is configured but not yet
	// moving money. If these ever match without the repricing work landing,
	// something is billing off a number nobody reviewed.
	if price["expected_quota"] == price["charged_quota"] {
		t.Error("expected_quota == charged_quota: discount appears to be billing already")
	}

	if _, ok := admin["cost"].(map[string]interface{}); !ok {
		t.Fatal("cost snapshot missing: margin needs both sides in one log row")
	}
}

// A channel with no discount configured must leave the price snapshot on the
// fallback branch and record no expected_quota — reporting a figure there would
// imply a discount is in force when billing never saw one.
func TestSnapshotWiring_UnconfiguredChannelRecordsNoExpectation(t *testing.T) {
	seedOfficialRatios(t, `{"wiring-fixture":2}`, `{"wiring-fixture":3}`, `{}`)

	other := map[string]interface{}{}
	writeSellPriceSnapshot(nil, "wiring-fixture", 5000, CostTokenBreakdown{
		PromptTokens: 1000, CompletionTokens: 500,
	}, other)

	price := other["admin_info"].(map[string]interface{})["price"].(map[string]interface{})
	if price["price_source"] != PriceSourceFallback {
		t.Errorf("price_source = %v, want fallback", price["price_source"])
	}
	if _, present := price["expected_quota"]; present {
		t.Error("expected_quota recorded for a channel with no discount")
	}
	// list_quota still lands: knowing what list price would have been is how an
	// operator sizes the opportunity before configuring anything.
	if price["list_quota"] != 5000 {
		t.Errorf("list_quota = %v, want 5000", price["list_quota"])
	}
}

func f64(v float64) *float64 { return &v }

// writeCostSnapshotForTest mirrors the admin_info.cost shape attachUpstreamCost
// produces. attachUpstreamCost itself needs a gin context and a RelayInfo with a
// ChannelMeta, which is more scaffolding than this assertion needs.
func writeCostSnapshotForTest(other map[string]interface{}, costQuota int, source string) {
	admin, ok := other["admin_info"].(map[string]interface{})
	if !ok || admin == nil {
		admin = map[string]interface{}{}
		other["admin_info"] = admin
	}
	admin["cost"] = map[string]interface{}{
		"cost_quota":  costQuota,
		"cost_source": source,
	}
}
