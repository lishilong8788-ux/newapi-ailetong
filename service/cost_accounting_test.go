package service

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func floatPtr(v float64) *float64 { return &v }

func TestComputeUpstreamCost_ExactRatioMode(t *testing.T) {

	cost := &dto.ChannelCostSettings{
		Models: map[string]dto.ModelCostPrice{
			"claude-sonnet-4": {
				Input:  floatPtr(3.0), // USD / 1M tokens
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

	// Free model: explicit zero input price is a legal $0 cost (exact), not
	// "unknown".
	cost := &dto.ChannelCostSettings{
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

	cost := &dto.ChannelCostSettings{
		Models: map[string]dto.ModelCostPrice{
			"mj-imagine": {PerCall: floatPtr(0.1)},
		},
	}
	quota, source := ComputeUpstreamCost(cost, "mj-imagine", CostInputs{Revenue: 100})
	require.Equal(t, CostSourceExact, source)
	assert.Equal(t, 50000, quota) // $0.1 * 500000
}

// 利润率不再反推成本：它现在是「进价 × (1 + 利润率) = 卖价」的正推方向，
// 拿收入除回去等于把卖价当成本。只配了利润率、没配进价的渠道必须是 unknown，
// 不参与毛利——报一个反推值出来会让毛利报表看起来正好等于配置的利润率，
// 那是自证预言，不是观测。
func TestComputeUpstreamCost_MarkupAloneIsUnknown(t *testing.T) {

	cost := &dto.ChannelCostSettings{DefaultMarkup: floatPtr(0.3)}
	quota, source := ComputeUpstreamCost(cost, "any-model", CostInputs{Revenue: 1300000})
	require.Equal(t, CostSourceUnknown, source)
	assert.Equal(t, 0, quota)
}

// 进价配了、利润率也配了，成本仍然只看进价：利润率与成本核算无关，它只影响
// 卖价（ResolveSellPrice）。
func TestComputeUpstreamCost_MarkupDoesNotAlterExactCost(t *testing.T) {

	cost := &dto.ChannelCostSettings{
		DefaultMarkup: floatPtr(0.3),
		Models: map[string]dto.ModelCostPrice{
			"m": {Input: floatPtr(3.0), Markup: floatPtr(2.0)},
		},
	}
	quota, source := ComputeUpstreamCost(cost, "m", CostInputs{
		Revenue: 9_999_999,
		Tokens:  CostTokenBreakdown{PromptTokens: 1_000_000},
	})
	require.Equal(t, CostSourceExact, source)
	assert.Equal(t, 1500000, quota) // $3 × 500000，与两个 markup 都无关
}

func TestComputeUpstreamCost_ReportedFallback(t *testing.T) {

	// No channel cost config; usage.Cost (OpenRouter truth) is the last rung.
	inputs := CostInputs{
		Revenue: 123,
		Usage:   &dto.Usage{Cost: 0.005},
	}
	quota, source := ComputeUpstreamCost(nil, "any-model", inputs)
	require.Equal(t, CostSourceReported, source)
	assert.Equal(t, 2500, quota) // $0.005 * 500000
}

func TestComputeUpstreamCost_RejectsAbsurdUnitPrices(t *testing.T) {

	// A unit price above the ceiling is treated as misconfiguration: falls
	// through to the next tier rather than producing a garbage cost.
	inf := math.Inf(1)
	nan := math.NaN()
	cost := &dto.ChannelCostSettings{
		Models: map[string]dto.ModelCostPrice{
			"bad-inf":  {Input: &inf},
			"bad-nan":  {Input: &nan},
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

func TestCostQuotaConversionBoundaries(t *testing.T) {

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
