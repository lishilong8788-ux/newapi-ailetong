package controller

import "testing"

// Unpriced traffic must not read as pure profit. RecordCostSample
// (service/cost_flush.go:55-60) adds an unknown request's revenue to
// revenue_quota but skips its cost, so the naive revenue-cost put that whole
// revenue in the margin. These cases pin the priced-only basis.
func TestPricedMargin(t *testing.T) {
	cases := []struct {
		name                   string
		revenue, cost, unknown int64
		wantMargin, wantBase   int64
	}{
		{
			name:    "no unknown traffic behaves as before",
			revenue: 1000, cost: 400, unknown: 0,
			wantMargin: 600, wantBase: 1000,
		},
		{
			// The regression this guards: 400 revenue / 380 cost / 200 unknown
			// reported +5% on the full basis; on priced revenue alone it is a
			// 90% loss. Overstated margin makes a bleeding channel look healthy,
			// which is the direction that costs money.
			name:    "unknown revenue is excluded from both sides",
			revenue: 400, cost: 380, unknown: 200,
			wantMargin: -180, wantBase: 200,
		},
		{
			name:    "all traffic unpriced leaves no basis",
			revenue: 500, cost: 0, unknown: 500,
			wantMargin: 0, wantBase: 0,
		},
		{
			// Defensive: unknown is a subset of revenue, so this cannot happen.
			// Clamping beats letting a negative basis flip the rate's sign.
			name:    "unknown exceeding revenue clamps instead of going negative",
			revenue: 100, cost: 50, unknown: 300,
			wantMargin: -50, wantBase: 0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			margin, base := pricedMargin(tc.revenue, tc.cost, tc.unknown)
			if margin != tc.wantMargin {
				t.Errorf("margin = %d, want %d", margin, tc.wantMargin)
			}
			if base != tc.wantBase {
				t.Errorf("base = %d, want %d", base, tc.wantBase)
			}
		})
	}
}

// A zero basis must produce no rate at all. Rendering 0% would claim the
// channel broke even, when the truth is there is nothing priced to measure.
func TestMarginRateOrNull_ZeroBasisIsNil(t *testing.T) {
	if rate := marginRateOrNull(0, -180); rate != nil {
		t.Errorf("rate = %v, want nil", *rate)
	}
	rate := marginRateOrNull(200, -180)
	if rate == nil {
		t.Fatal("rate = nil, want -0.9")
	}
	if *rate != -0.9 {
		t.Errorf("rate = %v, want -0.9", *rate)
	}
}
