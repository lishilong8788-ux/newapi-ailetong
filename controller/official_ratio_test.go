package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestParseRatioConfigOfficialRatios covers the conversion the official-price
// column depends on: the preset publishes billing expressions whose coefficients
// are the vendor's $/1M prices, and those have to land as ratios in the same unit
// as ModelRatio (ratio 1 == $0.002/1K == $2/1M) with completion and cache
// expressed relative to input.
func TestParseRatioConfigOfficialRatios(t *testing.T) {
	body := []byte(`{
	  "success": true,
	  "data": {
	    "billing_mode": {
	      "claude-opus-4-8": "tiered_expr",
	      "MiniMax-M2": "tiered_expr",
	      "wan2.7-image": "tiered_expr",
	      "broken-model": "tiered_expr",
	      "not-expression-billed": "fixed"
	    },
	    "billing_expr": {
	      "claude-opus-4-8": "tier(\"standard\", p * 5 + cr * 0.5 + cc * 6.25 + c * 25)",
	      "MiniMax-M2": "tier(\"standard\", p * 0.3 + c * 1.2)",
	      "wan2.7-image": "tier(\"standard\", p * 0 + c * 0)",
	      "broken-model": "tier(\"standard\", p * )",
	      "not-expression-billed": "tier(\"standard\", p * 99 + c * 99)"
	    }
	  }
	}`)

	set := newOfficialRatioSet()
	added, skipped, err := parseRatioConfigOfficialRatios(body, set)
	require.NoError(t, err)
	assert.Equal(t, 2, added)
	// wan2.7-image prices every token dimension at zero (a per-request image
	// model), and broken-model does not compile. Neither can anchor a discount.
	assert.Equal(t, 2, skipped)

	assert.Equal(t, map[string]float64{
		"claude-opus-4-8": 2.5, // $5 / 1M input
		"MiniMax-M2":      0.15,
	}, set.modelRatio)
	assert.Equal(t, map[string]float64{
		"claude-opus-4-8": 5, // $25 output / $5 input
		"MiniMax-M2":      4,
	}, set.completionRatio)
	// MiniMax-M2 publishes no separate cache price, so it must be absent rather
	// than stored as a free cache read.
	assert.Equal(t, map[string]float64{"claude-opus-4-8": 0.1}, set.cacheRatio)

	_, hasFixed := set.modelRatio["not-expression-billed"]
	assert.False(t, hasFixed, "a model not billed by expression must not be read as one")
}

// TestParseRatioConfigOfficialRatiosReadsFlatMaps keeps the documented
// ratio_config shape working: the endpoint is specified to serve flat ratio maps,
// and the current expression-only payload is one revision of it.
func TestParseRatioConfigOfficialRatiosReadsFlatMaps(t *testing.T) {
	body := []byte(`{
	  "success": true,
	  "data": {
	    "model_ratio": {"gpt-4o": 1.25, "free-model": 0, "junk-model": "abc"},
	    "completion_ratio": {"gpt-4o": 4},
	    "cache_ratio": {"gpt-4o": 0.5}
	  }
	}`)

	set := newOfficialRatioSet()
	added, skipped, err := parseRatioConfigOfficialRatios(body, set)
	require.NoError(t, err)
	assert.Equal(t, 1, added)
	// A zero input ratio cannot be a discount denominator, and a non-numeric one
	// is not a price at all.
	assert.Equal(t, 2, skipped)
	assert.Equal(t, map[string]float64{"gpt-4o": 1.25}, set.modelRatio)
	assert.Equal(t, map[string]float64{"gpt-4o": 4}, set.completionRatio)
	assert.Equal(t, map[string]float64{"gpt-4o": 0.5}, set.cacheRatio)
}

func TestParseRatioConfigOfficialRatiosRejectsFailedResponse(t *testing.T) {
	_, _, err := parseRatioConfigOfficialRatios([]byte(`{"success": false, "message": "upstream down"}`), newOfficialRatioSet())
	require.ErrorContains(t, err, "upstream down")
}

// TestOfficialRatioSetOverwriteDropsStaleSubRatios covers the merge hazard that
// makes the two sources combinable at all.
//
// Completion and cache ratios are multiples of the input price recorded alongside
// them. When a later source overrides the input price but publishes no cache
// ratio of its own, keeping the earlier one silently rebases it onto a different
// denominator and advertises a vendor price that no source published. Live data
// hit this on 11 models: models.dev gives qwen3-coder-30b-a3b-instruct input
// 0.0335 with cache ratio 0.208955, the preset overrides input to 0.225 and
// prices no cache at all.
func TestOfficialRatioSetOverwriteDropsStaleSubRatios(t *testing.T) {
	set := newOfficialRatioSet()
	firstCompletion, firstCache := 4.0, 0.208955
	require.True(t, set.put("qwen3-coder", 0.0335, &firstCompletion, &firstCache))

	// Second source: same model, different input price, no sub-ratios.
	require.True(t, set.put("qwen3-coder", 0.225, nil, nil))

	assert.Equal(t, map[string]float64{"qwen3-coder": 0.225}, set.modelRatio)
	assert.Empty(t, set.completionRatio, "a completion ratio from the previous input price must not survive")
	assert.Empty(t, set.cacheRatio, "a cache ratio from the previous input price must not survive")
}

// TestOfficialRatioSetOverwriteReplacesSubRatios is the other half: when the
// later source does publish sub-ratios, they replace rather than merge.
func TestOfficialRatioSetOverwriteReplacesSubRatios(t *testing.T) {
	set := newOfficialRatioSet()
	firstCompletion, firstCache := 4.0, 0.5
	require.True(t, set.put("gpt-4o", 1.25, &firstCompletion, &firstCache))

	secondCompletion := 5.0
	require.True(t, set.put("gpt-4o", 2.5, &secondCompletion, nil))

	assert.Equal(t, map[string]float64{"gpt-4o": 2.5}, set.modelRatio)
	assert.Equal(t, map[string]float64{"gpt-4o": 5}, set.completionRatio)
	assert.Empty(t, set.cacheRatio)
}

// TestOfficialRatioSetRejectsUnusableValues pins the guard that keeps corrupt
// source data out of the catalog. These are display values, but a NaN or an
// absurd number renders as a nonsense discount on every card.
func TestOfficialRatioSetRejectsUnusableValues(t *testing.T) {
	set := newOfficialRatioSet()
	negative := -1.0
	huge := 1e9

	assert.False(t, set.put("", 1, nil, nil), "blank model name")
	assert.False(t, set.put("m", 0, nil, nil), "zero input ratio")
	assert.False(t, set.put("m", -1, nil, nil), "negative input ratio")
	assert.False(t, set.put("m", officialRatioMaxRatio*10, nil, nil), "input ratio past the sanity bound")

	require.True(t, set.put("kept", 2, &negative, &huge))
	assert.Equal(t, map[string]float64{"kept": 2}, set.modelRatio)
	assert.Empty(t, set.completionRatio, "negative completion ratio must be dropped")
	assert.Empty(t, set.cacheRatio, "out-of-range cache ratio must be dropped")
}
