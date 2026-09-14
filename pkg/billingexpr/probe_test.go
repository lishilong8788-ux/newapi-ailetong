package billingexpr

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestProbeListPricesRecoversPublishedPrices pins the contract the official-price
// display depends on: for a v1 expression, the coefficients ARE the vendor's
// published $/1M prices, so probing must read them back exactly — including from
// shapes a regex over the expression string would get wrong (reversed operands,
// tiers, time-of-day branches).
func TestProbeListPricesRecoversPublishedPrices(t *testing.T) {
	cases := []struct {
		name string
		expr string
		want ListPrices
	}{
		{
			name: "flat pricing with cache read",
			// claude-opus-4-8, as published by the official ratio preset. The cache
			// *creation* coefficients are deliberately ignored — see ListPrices.
			expr: `tier("standard", p * 5 + cr * 0.5 + cc * 6.25 + cc1h * 10 + c * 25)`,
			want: ListPrices{
				Input:        5,
				Output:       25,
				CacheRead:    0.5,
				HasCacheRead: true,
			},
		},
		{
			name: "no cache pricing at all",
			expr: `tier("standard", p * 0.57 + c * 2.29)`,
			want: ListPrices{Input: 0.57, Output: 2.29},
		},
		{
			name: "tiered expression reports the entry tier",
			// gpt-5.5: Len is pinned to 1 by the probe, so the long-context tier
			// (p * 10) must not be the one that answers.
			expr: `len <= 272000 ? tier("0_272k", p * 5 + cr * 0.5 + c * 30) : tier("272k_plus", p * 10 + cr * 1 + c * 45)`,
			want: ListPrices{Input: 5, Output: 30, CacheRead: 0.5, HasCacheRead: true},
		},
		{
			name: "coefficient written before the variable",
			expr: `tier("base", 3 * p + 15 * c)`,
			want: ListPrices{Input: 3, Output: 15},
		},
		{
			name: "cache read priced at zero is not the same as unpriced",
			expr: `tier("base", p * 2 + c * 8 + cr * 0)`,
			want: ListPrices{Input: 2, Output: 8, CacheRead: 0, HasCacheRead: true},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			prices, err := ProbeListPrices(testCase.expr)
			require.NoError(t, err)
			assert.Equal(t, testCase.want, prices)
		})
	}
}

func TestProbeListPricesRejectsUnusableExpressions(t *testing.T) {
	cases := []struct {
		name string
		expr string
	}{
		{name: "does not compile", expr: `tier("base", p * )`},
		// A free model has no input price to express output/cache against, so it
		// cannot produce a discount comparison and must be reported as such
		// rather than stored as a division by zero.
		{name: "no input price", expr: `tier("base", c * 5)`},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := ProbeListPrices(testCase.expr)
			require.Error(t, err)
		})
	}
}
