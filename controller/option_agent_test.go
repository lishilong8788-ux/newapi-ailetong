package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// updateOptionRejection drives UpdateOption and returns the failure message.
// Rejected values never reach model.UpdateOption, so no database is needed.
//
// The controller package leaves i18n uninitialised, so common.TranslateMessage
// passes the message key through untouched and the key itself is the assertion
// target.
func updateOptionRejection(t *testing.T, key string, rawValue string) string {
	t.Helper()

	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		strings.NewReader(fmt.Sprintf(`{"key":%q,"value":%s}`, key, rawValue)),
	)

	UpdateOption(context)

	require.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	require.False(t, payload.Success, "expected %s=%s to be rejected", key, rawValue)
	return payload.Message
}

// A rate above 1 makes every top-up a net loss, and the frontend is not the
// authority on that bound. See docs/代理分销-设计方案.md §12 and §13.1.
func TestUpdateOptionRejectsOutOfRangeAgentRates(t *testing.T) {
	originalMaxRate := setting.AgentMaxRate
	setting.AgentMaxRate = 0.30
	t.Cleanup(func() { setting.AgentMaxRate = originalMaxRate })

	cases := []struct {
		name     string
		key      string
		rawValue string
		expected string
	}{
		{"default rate above 100%", "AgentDefaultRate", `1.5`, i18n.MsgAgentRateOutOfRange},
		{"default rate below zero", "AgentDefaultRate", `-0.01`, i18n.MsgAgentRateOutOfRange},
		{"max rate above 100%", "AgentMaxRate", `2`, i18n.MsgAgentRateOutOfRange},
		{"fee rate above 100%", "AgentWithdrawalFeeRate", `1.01`, i18n.MsgAgentRateOutOfRange},
		{"fee rate below zero", "AgentWithdrawalFeeRate", `-1`, i18n.MsgAgentRateOutOfRange},
		// ParseFloat accepts "NaN" and "Inf", so both need an explicit guard:
		// a NaN rate would slip past every ordered comparison.
		{"NaN rate", "AgentDefaultRate", `"NaN"`, i18n.MsgAgentRateInvalid},
		{"infinite rate", "AgentMaxRate", `"+Inf"`, i18n.MsgAgentRateOutOfRange},
		{"non-numeric rate", "AgentDefaultRate", `"abc"`, i18n.MsgAgentRateInvalid},
		{"empty rate", "AgentDefaultRate", `""`, i18n.MsgAgentRateInvalid},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			message := updateOptionRejection(t, testCase.key, testCase.rawValue)
			assert.Equal(t, testCase.expected, message)
		})
	}
}

func TestUpdateOptionRejectsAgentDefaultRateAboveConfiguredCeiling(t *testing.T) {
	originalMaxRate := setting.AgentMaxRate
	setting.AgentMaxRate = 0.10
	t.Cleanup(func() { setting.AgentMaxRate = originalMaxRate })

	message := updateOptionRejection(t, "AgentDefaultRate", `0.5`)
	assert.Equal(t, i18n.MsgAgentDefaultRateAboveMax, message)
}

func TestUpdateOptionRejectsInvalidAgentFreezeDays(t *testing.T) {
	cases := []struct {
		name     string
		rawValue string
	}{
		{"negative window", `-1`},
		{"fractional window", `1.5`},
		{"non-numeric window", `"soon"`},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			message := updateOptionRejection(t, "AgentFreezeDays", testCase.rawValue)
			assert.Equal(t, i18n.MsgAgentFreezeDaysInvalid, message)
		})
	}
}

func TestUpdateOptionRejectsNonPositiveAgentMinWithdrawal(t *testing.T) {
	cases := []struct {
		name     string
		rawValue string
	}{
		{"zero", `0`},
		{"negative", `-50`},
		{"NaN", `"NaN"`},
		{"infinite", `"+Inf"`},
		{"non-numeric", `"lots"`},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			message := updateOptionRejection(t, "AgentMinWithdrawal", testCase.rawValue)
			assert.Equal(t, i18n.MsgAgentMinWithdrawalInvalid, message)
		})
	}
}
