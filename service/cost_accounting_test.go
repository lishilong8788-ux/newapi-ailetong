package service

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	costsetting "github.com/QuantumNous/new-api/setting/cost_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func floatPtr(v float64) *float64 { return &v }

// enableCostSetting flips cost accounting on for the duration of a test.
// costSetting is a package-level var in cost_setting; the getter returns a
// copy, so tests mutate through a helper that swaps the var directly.
func withCostEnabled(t *testing.T, enabled bool) {
	t.Helper()
	original := costsetting.GetSetting().Enabled
	setCostEnabledForTest(enabled)
	t.Cleanup(func() { setCostEnabledForTest(original) })
}

func setCostEnabledForTest(enabled bool) {
	// The config struct is package-private; Enabled is exposed via GetSetting
	// returning a copy. Mutate through the exported test hook instead of
	// reaching into the package.
	costsetting.SetEnabledForTest(enabled)
}

func TestComputeUpstreamCost_ExactRatioMode(t *testing.T) {
	withCostEnabled(t, true)

	cost := &dto.ChannelCostSettings{
		Mode: "ratio",
		Models: map[string]dto.ModelCostPrice{
			"claude-sonnet-4": {
				Input:  floatPtr(3.0),  // USD / 1M tokens
				Output: floatPtr(15.0),
			},
		},
	}
	inputs := CostInputs{
		Revenue: 0,
		Tokens: CostTokenBreakdown{
			PromptTokens:     1_000_000,
			CompletionTokens: 500_000,
		},
	}

	quota, source := ComputeUpstreamCost(cost, "claude-sonnet-4", inputs)
	require.Equal(t, CostSourceExact, source)
	// 1M * $3 + 0.5M * $15 = $3 + $7.5 = $10.5 → 10.5 * 500000 = 5250000
	assert.Equal(t, 5250000, quota)
}

func TestComputeUpstreamCost_ExactDistinguishesZeroFromUnset(t *testing.T) {
	withCostEnabled(t, true)

	// Free model: explicit zero input price is a legal $0 cost (exact), not
	// "unknown".
	cost := &dto.ChannelCostSettings{
		Mode: "ratio",
		Models: map[string]dto.ModelCostPrice{
			"free-model": {Input: floatPtr(0)},
		},
	}
	quota, source := ComputeUpstreamCost(cost, "free-model", CostInputs{
		Tokens: CostTokenBreakdown{PromptTokens: 100000},
	})
	require.Equal(t, CostSourceExact, source)
	assert.Equal(t, 0, quota)

	// No entry at all and no fallbacks configured → unknown, never 0-cost.
	quota, source = ComputeUpstreamCost(cost, "missing-model", CostInputs{
		Tokens: CostTokenBreakdown{PromptTokens: 100000},
	})
	assert.Equal(t, CostSourceUnknown, source)
	assert.Equal(t, 0, quota)
}

func TestComputeUpstreamCost_PerCallMode(t *testing.T) {
	withCostEnabled(t, true)

	cost := &dto.ChannelCostSettings{
		Mode: "per_call",
		Models: map[string]dto.ModelCostPrice{
			"mj-imagine": {PerCall: floatPtr(0.1)},
		},
	}
	quota, source := ComputeUpstreamCost(cost, "mj-imagine", CostInputs{Revenue: 100})
	require.Equal(t, CostSourceExact, source)
	assert.Equal(t, 50000, quota) // $0.1 * 500000
}

func TestComputeUpstreamCost_MarkupFallback(t *testing.T) {
	withCostEnabled(t, true)

	// markup = 0.3 → cost = revenue / 1.3
	cost := &dto.ChannelCostSettings{DefaultMarkup: floatPtr(0.3)}
	quota, source := ComputeUpstreamCost(cost, "any-model", CostInputs{Revenue: 1300000})
	require.Equal(t, CostSourceMarkup, source)
	// $2.6 / 1.3 = $2 → 1000000
	assert.Equal(t, 1000000, quota)
}

func TestComputeUpstreamCost_ReportedFallback(t *testing.T) {
	withCostEnabled(t, true)

	// No channel cost config; usage.Cost (OpenRouter truth) takes tier 3.
	inputs := CostInputs{
		Revenue: 123,
		Usage:   &dto.Usage{Cost: 0.005},
	}
	quota, source := ComputeUpstreamCost(nil, "any-model", inputs)
	require.Equal(t, CostSourceReported, source)
	assert.Equal(t, 2500, quota) // $0.005 * 500000
}

func TestComputeUpstreamCost_RejectsAbsurdUnitPrices(t *testing.T) {
	withCostEnabled(t, true)

	// A unit price above the ceiling is treated as misconfiguration: falls
	// through to the next tier rather than producing a garbage cost.
	inf := math.Inf(1)
	nan := math.NaN()
	cost := &dto.ChannelCostSettings{
		Mode: "ratio",
		Models: map[string]dto.ModelCostPrice{
			"bad-inf": {Input: &inf},
			"bad-nan": {Input: &nan},
			"bad-huge": {Input: floatPtr(1e9)},
		},
	}
	for _, model := range []string{"bad-inf", "bad-nan", "bad-huge"} {
		_, source := ComputeUpstreamCost(cost, model, CostInputs{
			Tokens: CostTokenBreakdown{PromptTokens: 1000},
		})
		assert.Equal(t, CostSourceUnknown, source, "model %s should not resolve to exact", model)
	}
}

func TestCostUSDToQuota_NeverNegative(t *testing.T) {
	withCostEnabled(t, true)

	// costUSDToQuota clamps at 0; a negative USD input is rejected outright.
	assert.Equal(t, 0, costUSDToQuota(0))
	assert.Equal(t, 0, costUSDToQuota(-5))
	assert.Equal(t, 500000, costUSDToQuota(1))
}

func TestUpstreamReportedCostUSD_Shapes(t *testing.T) {
	// number form
	usd, ok := upstreamReportedCostUSD(&dto.Usage{Cost: 0.0123})
	require.True(t, ok)
	assert.InDelta(t, 0.0123, usd, 1e-9)

	// object form {total: ...}
	usd, ok = upstreamReportedCostUSD(&dto.Usage{
		Cost: map[string]interface{}{"total": 0.02},
	})
	require.True(t, ok)
	assert.InDelta(t, 0.02, usd, 1e-9)

	// negative / NaN rejected
	_, ok = upstreamReportedCostUSD(&dto.Usage{Cost: -1})
	assert.False(t, ok)
	_, ok = upstreamReportedCostUSD(&dto.Usage{Cost: math.NaN()})
	assert.False(t, ok)
	_, ok = upstreamReportedCostUSD(nil)
	assert.False(t, ok)
}

func TestCostInputsFromUsage_OpenAISemanticSplitsSubcategories(t *testing.T) {
	usage := &dto.Usage{
		PromptTokens:     1000,
		CompletionTokens: 300,
		UsageSemantic:    "openai",
	}
	usage.PromptTokensDetails.CachedTokens = 200
	usage.PromptTokensDetails.ImageTokens = 100
	usage.PromptTokensDetails.AudioTokens = 50
	usage.CompletionTokenDetails.ReasoningTokens = 80

	inputs := CostInputsFromUsage(usage, 42)
	// 1000 - 200 - 100 - 50 = 650 text input tokens
	assert.Equal(t, 650, inputs.Tokens.PromptTokens)
	assert.Equal(t, 300, inputs.Tokens.CompletionTokens)
	assert.Equal(t, 200, inputs.Tokens.CacheReadTokens)
	assert.Equal(t, 100, inputs.Tokens.ImageInput)
	assert.Equal(t, 50, inputs.Tokens.AudioInput)
	assert.Equal(t, 80, inputs.Tokens.ReasoningTokens)
	assert.Equal(t, 42, inputs.Revenue)
}

func TestCostInputsFromUsage_ClaudeSemanticKeepsTotals(t *testing.T) {
	usage := &dto.Usage{
		PromptTokens:     600,
		CompletionTokens: 200,
		UsageSemantic:    "anthropic",
	}
	usage.PromptTokensDetails.CachedTokens = 100
	usage.ClaudeCacheCreation5mTokens = 50
	usage.ClaudeCacheCreation1hTokens = 20

	inputs := CostInputsFromUsage(usage, 7)
	// Claude semantic: prompt is already text-only; no subtraction.
	assert.Equal(t, 600, inputs.Tokens.PromptTokens)
	assert.Equal(t, 50, inputs.Tokens.CacheWrite5m)
	assert.Equal(t, 20, inputs.Tokens.CacheWrite1h)
}

func TestCostInputsFromUsage_ClampsNegativeRemainder(t *testing.T) {
	// OpenAI cache-write counts unadjusted prefixes, so subcategories can
	// exceed the prompt total. The remainder must clamp to 0, never negative.
	usage := &dto.Usage{
		PromptTokens:  100,
		UsageSemantic: "openai",
	}
	usage.PromptTokensDetails.CachedTokens = 150
	inputs := CostInputsFromUsage(usage, 1)
	assert.Equal(t, 0, inputs.Tokens.PromptTokens)
}

func TestMarginRateConversionIdentities(t *testing.T) {
	// margin = markup / (1 + markup); markup = margin / (1 - margin)
	// Spot-check the round trip over a few points to lock the definitions.
	for _, markup := range []float64{0.3, 0.5, 1.0, 2.0} {
		margin := markup / (1 + markup)
		back := margin / (1 - margin)
		assert.InDelta(t, markup, back, 1e-9)
	}
	// The classic example: cost $100 sold at $130 → markup 30%, margin 23.08%
	markup := 0.3
	margin := markup / (1 + markup)
	assert.InDelta(t, 0.230769, margin, 1e-5)
}

func TestComputeUpstreamCost_DisabledAlwaysUnknown(t *testing.T) {
	withCostEnabled(t, false)

	cost := &dto.ChannelCostSettings{
		Mode: "ratio",
		Models: map[string]dto.ModelCostPrice{
			"claude-sonnet-4": {Input: floatPtr(3.0)},
		},
	}
	quota, source := ComputeUpstreamCost(cost, "claude-sonnet-4", CostInputs{
		Tokens: CostTokenBreakdown{PromptTokens: 1000000},
	})
	assert.Equal(t, CostSourceUnknown, source)
	assert.Equal(t, 0, quota)
}

func TestCostQuotaConversionBoundaries(t *testing.T) {
	withCostEnabled(t, true)

	// QuotaPerUnit is a var (runtime-changeable); pin the arithmetic against
	// the current value rather than hardcoding 500000.
	original := common.QuotaPerUnit
	t.Cleanup(func() { common.QuotaPerUnit = original })
	common.QuotaPerUnit = 500000

	// Tiny: $0.000002 → 1 quota (truncation toward zero)
	assert.Equal(t, 1, costUSDToQuota(0.000002))
	// Saturating: an absurd USD cost clamps to int32 quota bound and is
	// logged, not wrapped negative.
	quota := costUSDToQuota(1e18)
	assert.True(t, quota >= 0, "saturated cost must never be negative, got %d", quota)
}
