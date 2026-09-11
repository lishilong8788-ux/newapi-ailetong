package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The console hides the agent workbench entry and refuses /agent based on this
// flag, so the payload has to track setting.AgentEnabled in both directions. A
// flag stuck at true would route users to a page every request rejects; stuck at
// false it would hide a programme the operator just switched on.
func TestGetStatusReportsAgentEnabled(t *testing.T) {
	originalAgentEnabled := setting.AgentEnabled
	originalOptionMap := common.OptionMap
	t.Cleanup(func() {
		setting.AgentEnabled = originalAgentEnabled
		common.OptionMap = originalOptionMap
	})
	common.OptionMap = map[string]string{}

	for _, enabled := range []bool{true, false} {
		setting.AgentEnabled = enabled

		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

		GetStatus(c)

		require.Equal(t, http.StatusOK, response.Code)

		var body struct {
			Success bool `json:"success"`
			Data    struct {
				AgentEnabled bool `json:"agent_enabled"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		require.True(t, body.Success)
		assert.Equal(t, enabled, body.Data.AgentEnabled)
	}
}
