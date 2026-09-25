package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/copilot_setting"
)

// newCopilotConfigTestDB migrates the tables UpdateCopilotConfig touches: options
// are what it writes, channels are what it validates a pin against.
func newCopilotConfigTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	oldDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.Channel{}))
	model.DB = db

	// UpdateOptionsBulk writes through common.OptionMap, which is nil outside a
	// booted process; without it the handler panics rather than failing.
	common.OptionMapRWMutex.Lock()
	oldOptionMap := common.OptionMap
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()

	t.Cleanup(func() {
		model.DB = oldDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptionMap
		common.OptionMapRWMutex.Unlock()
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func seedCopilotTestChannel(t *testing.T, db *gorm.DB, id int, status int) {
	t.Helper()
	require.NoError(t, db.Create(&model.Channel{
		Id:     id,
		Type:   1,
		Key:    "k",
		Status: status,
		Name:   "copilot channel",
	}).Error)
}

// callCopilotConfig posts a config update as a root user.
func callCopilotConfig(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/copilot/config", strings.NewReader(body))
	c.Set("id", 1)
	c.Set("role", common.RoleRootUser)
	UpdateCopilotConfig(c)
	return w
}

// The whole point of configuring from the chat page is that the operator sees the
// result immediately, so the write must land in the live config (not just the
// options table) and the response must carry the new state.
func TestUpdateCopilotConfig_AppliesSelection(t *testing.T) {
	db := newCopilotConfigTestDB(t)
	seedCopilotTestChannel(t, db, 7, common.ChannelStatusEnabled)
	setCopilotSetting(t, map[string]string{
		"enabled": "false", "model": "", "channel_id": "0", "max_rounds": "8",
	})

	envelope := decodeEnvelope(t, callCopilotConfig(t,
		`{"enabled":true,"model":" gpt-5 ","channel_id":7}`))
	require.Equal(t, true, envelope["success"], "body: %v", envelope)

	setting := copilot_setting.GetSetting()
	assert.True(t, setting.Enabled)
	assert.Equal(t, "gpt-5", copilot_setting.GetModel(), "模型名要去掉空白，否则路由阶段匹配不到")
	assert.Equal(t, 7, setting.ChannelId)

	data := envelope["data"].(map[string]any)
	assert.Equal(t, true, data["configured"])
	assert.Equal(t, "gpt-5", data["model"])
	assert.Equal(t, float64(7), data["channel_id"])
	assert.Equal(t, true, data["can_configure"])
}

// Changing the model must not touch the switch. The picker sends one field at a
// time, and a request that omits `enabled` silently turning the copilot off would
// read as the model change having broken it.
func TestUpdateCopilotConfig_OmittedFieldsAreLeftAlone(t *testing.T) {
	newCopilotConfigTestDB(t)
	setCopilotSetting(t, map[string]string{
		"enabled": "true", "model": "gpt-5", "channel_id": "0", "max_rounds": "3",
	})

	require.Equal(t, true, decodeEnvelope(t, callCopilotConfig(t,
		`{"model":"claude-4"}`))["success"])

	setting := copilot_setting.GetSetting()
	assert.True(t, setting.Enabled, "没发 enabled 就不该动开关")
	assert.Equal(t, "claude-4", setting.Model)
	assert.Equal(t, 3, copilot_setting.GetMaxRounds(), "轮数不在这个接口的职责里")
}

// Clearing the pin is a real operation: an operator who pinned a channel needs a
// way back to normal routing, and 0 is how that is spelled.
func TestUpdateCopilotConfig_ClearsPin(t *testing.T) {
	newCopilotConfigTestDB(t)
	setCopilotSetting(t, map[string]string{
		"enabled": "true", "model": "gpt-5", "channel_id": "9", "max_rounds": "8",
	})

	require.Equal(t, true, decodeEnvelope(t, callCopilotConfig(t,
		`{"channel_id":0}`))["success"])
	assert.Equal(t, 0, copilot_setting.GetSetting().ChannelId)
}

// A pin is validated on save rather than on the next message. Saved unchecked,
// a deleted or disabled channel surfaces as "选择副驾渠道失败" mid-conversation,
// which points at the copilot rather than at the field that is wrong.
func TestUpdateCopilotConfig_RejectsUnusablePin(t *testing.T) {
	db := newCopilotConfigTestDB(t)
	seedCopilotTestChannel(t, db, 5, common.ChannelStatusManuallyDisabled)
	setCopilotSetting(t, map[string]string{
		"enabled": "true", "model": "gpt-5", "channel_id": "0", "max_rounds": "8",
	})

	cases := map[string]string{
		"missing channel":  `{"channel_id":404}`,
		"disabled channel": `{"channel_id":5}`,
		"negative id":      `{"channel_id":-1}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			envelope := decodeEnvelope(t, callCopilotConfig(t, body))
			assert.Equal(t, false, envelope["success"])
			assert.Equal(t, 0, copilot_setting.GetSetting().ChannelId, "拒绝时不能留下半个写入")
		})
	}
}

// An empty body is a no-op request, not a reset. Treating it as "write all three
// defaults" would let a stray request from the picker disable the copilot.
func TestUpdateCopilotConfig_RejectsEmptyUpdate(t *testing.T) {
	newCopilotConfigTestDB(t)
	setCopilotSetting(t, map[string]string{
		"enabled": "true", "model": "gpt-5", "channel_id": "0", "max_rounds": "8",
	})

	assert.Equal(t, false, decodeEnvelope(t, callCopilotConfig(t, `{}`))["success"])
	assert.True(t, copilot_setting.GetSetting().Enabled)
	assert.Equal(t, "gpt-5", copilot_setting.GetModel())
}

// can_configure drives whether the picker renders as editable. An admin who is not
// root gets the copilot but not the write: copilot_setting.* is a global option and
// PUT /api/copilot/config is root-gated, so a picker that looked editable for them
// would answer with a 403.
func TestCopilotStatus_CanConfigureFollowsRole(t *testing.T) {
	setCopilotSetting(t, map[string]string{
		"enabled": "true", "model": "gpt-5", "channel_id": "0", "max_rounds": "8",
	})

	for role, expected := range map[int]bool{
		common.RoleAdminUser: false,
		common.RoleRootUser:  true,
	} {
		gin.SetMode(gin.TestMode)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/copilot/status", nil)
		c.Set("id", 1)
		c.Set("role", role)
		GetCopilotStatus(c)

		data := decodeEnvelope(t, w)["data"].(map[string]any)
		assert.Equal(t, expected, data["can_configure"], "role=%d", role)
	}
}
