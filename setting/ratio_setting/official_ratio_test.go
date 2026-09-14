package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOfficialRatioLookupNormalizesModelName pins the contract that makes the
// catalog's two price columns comparable: the official ratio has to be found
// under the same normalized key the platform ratio is. A parameterized model like
// `gpt-4o-gizmo-abc` bills off the `gpt-4o-gizmo-*` entry, so if the official
// lookup keyed on the raw name it would find nothing and the model would show a
// platform price beside an empty official column.
func TestOfficialRatioLookupNormalizesModelName(t *testing.T) {
	require.NoError(t, UpdateOfficialModelRatioByJSONString(`{"gpt-4o-gizmo-*": 1.25}`))
	require.NoError(t, UpdateOfficialCompletionRatioByJSONString(`{"gpt-4o-gizmo-*": 4}`))
	require.NoError(t, UpdateOfficialCacheRatioByJSONString(`{"gpt-4o-gizmo-*": 0.5}`))
	t.Cleanup(func() {
		require.NoError(t, UpdateOfficialModelRatioByJSONString(""))
		require.NoError(t, UpdateOfficialCompletionRatioByJSONString(""))
		require.NoError(t, UpdateOfficialCacheRatioByJSONString(""))
	})

	// Same normalization GetModelRatio applies.
	_, _, normalized := GetModelRatio("gpt-4o-gizmo-abc")
	require.Equal(t, "gpt-4o-gizmo-*", normalized)

	modelRatio, ok := GetOfficialModelRatio("gpt-4o-gizmo-abc")
	require.True(t, ok)
	assert.Equal(t, 1.25, modelRatio)

	completionRatio, ok := GetOfficialCompletionRatio("gpt-4o-gizmo-abc")
	require.True(t, ok)
	assert.Equal(t, 4.0, completionRatio)

	cacheRatio, ok := GetOfficialCacheRatio("gpt-4o-gizmo-abc")
	require.True(t, ok)
	assert.Equal(t, 0.5, cacheRatio)

	_, ok = GetOfficialModelRatio("some-other-model")
	assert.False(t, ok, "an unsynced model must report no official price")
}

// TestOfficialRatioBlankOptionIsNotAnError covers a fresh install: the option row
// does not exist yet, so the loader is handed "". The billing ratio loaders treat
// that as a parse failure, which would log an error on every startup for a state
// that is simply "the sync has not run".
func TestOfficialRatioBlankOptionIsNotAnError(t *testing.T) {
	require.NoError(t, UpdateOfficialModelRatioByJSONString(`{"gpt-4o": 1.25}`))
	require.NoError(t, UpdateOfficialModelRatioByJSONString("   "))

	_, ok := GetOfficialModelRatio("gpt-4o")
	assert.False(t, ok, "a blank option must clear the map, not keep stale prices")
	assert.Equal(t, "{}", OfficialModelRatio2JSONString())
}

// TestOfficialRatiosAreNotExposedAsBillingData guards the separation that keeps
// this feature display-only: /api/ratio_config publishes what THIS site charges,
// and a downstream instance syncs its own billing ratios from it. Leaking vendor
// list prices into that payload would let another deployment adopt them as
// charges.
func TestOfficialRatiosAreNotExposedAsBillingData(t *testing.T) {
	require.NoError(t, UpdateOfficialModelRatioByJSONString(`{"official-only-model": 99}`))
	t.Cleanup(func() {
		require.NoError(t, UpdateOfficialModelRatioByJSONString(""))
	})
	InvalidateExposedDataCache()

	exposed := GetExposedData()
	assert.NotContains(t, exposed, "official_model_ratio")
	assert.NotContains(t, exposed, "official_completion_ratio")
	assert.NotContains(t, exposed, "official_cache_ratio")

	modelRatios, ok := exposed["model_ratio"].(map[string]float64)
	require.True(t, ok)
	assert.NotContains(t, modelRatios, "official-only-model")
}
