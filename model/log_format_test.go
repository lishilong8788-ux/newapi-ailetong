package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/require"
)

// TestFormatUserLogsStripsQuotaSaturation verifies the admin-only quota
// saturation marker (nested under other.admin_info) is removed for non-admin
// log views, since formatUserLogs strips the whole admin_info object.
func TestFormatUserLogsStripsQuotaSaturation(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_price": 0.004,
		"admin_info": map[string]interface{}{
			"quota_saturation": map[string]interface{}{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	// Non-admin billing fields remain visible.
	require.Contains(t, parsed, "model_price")
}

// TestFormatUserLogsStripsChannelIdentity pins the channel identity fields to
// admin views. channel_type is what the margin ledger reads to name the upstream
// vendor, so leaking it would tell a customer which provider is behind the
// gateway even though channel_name is already blanked.
func TestFormatUserLogsStripsChannelIdentity(t *testing.T) {
	logs := []*Log{{
		ChannelId:   7,
		ChannelName: "azure-eastus",
		ChannelType: 3,
		Other:       common.MapToJsonStr(map[string]interface{}{"model_price": 0.004}),
	}}

	formatUserLogs(logs, 0)

	require.Empty(t, logs[0].ChannelName)
	require.Zero(t, logs[0].ChannelType)
}
