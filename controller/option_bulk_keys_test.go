package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetOptionsSkipsBulkKeysButKeepsControls pins both halves of the
// official-price option filtering:
//
//   - The three ratio maps are withheld. They run to a few hundred KB, and the
//     settings page reads none of them, so shipping them would add that to every
//     settings load.
//   - The two controls the settings page DOES read must still come through.
//     Withholding either would silently strand the panel on its defaults: the
//     switch would read "off" while auto-sync was on, and the timestamp would
//     read "never synced" after a successful sync.
func TestGetOptionsSkipsBulkKeysButKeepsControls(t *testing.T) {
	gin.SetMode(gin.TestMode)

	common.OptionMapRWMutex.Lock()
	original := common.OptionMap
	common.OptionMap = map[string]string{
		"OfficialModelRatio":           `{"gpt-4o": 1.25}`,
		"OfficialCompletionRatio":      `{"gpt-4o": 4}`,
		"OfficialCacheRatio":           `{"gpt-4o": 0.5}`,
		"OfficialRatioAutoSyncEnabled": "true",
		"OfficialRatioSyncedAt":        "1789380475",
		"ModelRatio":                   `{"gpt-4o": 0.5}`,
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = original
		common.OptionMapRWMutex.Unlock()
	})

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/option/", nil)
	GetOptions(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var body struct {
		Success bool `json:"success"`
		Data    []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.True(t, body.Success)

	values := make(map[string]string, len(body.Data))
	for _, option := range body.Data {
		values[option.Key] = option.Value
	}

	for _, key := range []string{"OfficialModelRatio", "OfficialCompletionRatio", "OfficialCacheRatio"} {
		assert.NotContains(t, values, key, "bulk ratio map must not be sent to the settings page")
	}

	assert.Equal(t, "true", values["OfficialRatioAutoSyncEnabled"])
	assert.Equal(t, "1789380475", values["OfficialRatioSyncedAt"])
	// The billing ratio map is still published: the settings page edits it.
	assert.Equal(t, `{"gpt-4o": 0.5}`, values["ModelRatio"])
}
