package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	channelPinModel        = "pin-test-model"
	channelPinEnabledId    = 9101
	channelPinOtherModelId = 9102
	channelPinDisabledId   = 9103
)

// setupChannelPinTest installs three channels: one enabled and serving
// channelPinModel (with a model_mapping that names a line), one enabled but
// serving a different model, and one disabled.
func setupChannelPinTest(t *testing.T) {
	t.Helper()
	require.NoError(t, i18n.Init())

	previousDB := model.DB
	previousType := common.MainDatabaseType()
	previousMemoryCache := common.MemoryCacheEnabled

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.MemoryCacheEnabled = true

	fixtureLineCode := "hs4"
	channels := []*model.Channel{
		{Id: channelPinEnabledId, Type: 1, Key: "k", Name: "pinned", Status: common.ChannelStatusEnabled,
			Models: channelPinModel, Group: "default", LineCode: &fixtureLineCode},
		{Id: channelPinOtherModelId, Type: 1, Key: "k", Name: "other-model", Status: common.ChannelStatusEnabled,
			Models: "some-other-model", Group: "default"},
		{Id: channelPinDisabledId, Type: 1, Key: "k", Name: "disabled", Status: common.ChannelStatusManuallyDisabled,
			Models: channelPinModel, Group: "default"},
	}
	for _, channel := range channels {
		require.NoError(t, model.DB.Create(channel).Error)
		require.NoError(t, channel.AddAbilities(nil))
	}
	model.InitChannelCache()

	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.MemoryCacheEnabled = previousMemoryCache
	})
}

type channelPinResult struct {
	status     int
	body       string
	pinnedTo   any
	pinPresent bool
	reached    bool
}

// runChannelPin drives PlaygroundChannelPin with the given role and header on a
// chat-completions request for modelName, reporting the raw context value the
// downstream handler would see.
func runChannelPin(t *testing.T, role int, setHeader bool, header string, modelName string) channelPinResult {
	t.Helper()
	gin.SetMode(gin.TestMode)

	result := channelPinResult{}
	router := gin.New()
	router.POST("/pg/chat/completions", func(c *gin.Context) {
		c.Set("role", role)
		c.Next()
	}, PlaygroundChannelPin(), func(c *gin.Context) {
		result.reached = true
		result.pinnedTo, result.pinPresent = common.GetContextKey(c, constant.ContextKeyTokenSpecificChannelId)
		c.Status(http.StatusOK)
	})

	body := `{"model":"` + modelName + `","messages":[]}`
	request := httptest.NewRequest(http.MethodPost, "/pg/chat/completions", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if setHeader {
		request.Header.Set(HeaderChannelId, header)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	result.status = recorder.Code
	result.body = recorder.Body.String()
	return result
}

// Automatic routing is the default path: without the header the middleware must
// leave the context exactly as Distribute expects it for channel selection.
func TestPlaygroundChannelPinWithoutHeaderLeavesRoutingUntouched(t *testing.T) {
	setupChannelPinTest(t)

	// Both a missing header and a present-but-empty one: an empty value is what a
	// frontend sends when the user picked "automatic", and it must route, not 400.
	for _, tc := range []struct {
		name      string
		setHeader bool
	}{
		{name: "header absent", setHeader: false},
		{name: "header empty", setHeader: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := runChannelPin(t, common.RoleAdminUser, tc.setHeader, "", channelPinModel)
			require.True(t, result.reached)
			assert.Equal(t, http.StatusOK, result.status)
			assert.False(t, result.pinPresent, "no pin header must not set the specific-channel key")
		})
	}
}

func TestPlaygroundChannelPinRejectsMalformedChannelId(t *testing.T) {
	setupChannelPinTest(t)

	// Admin role throughout: a malformed value must fail on its own, not because
	// the caller happened to lack the privilege.
	for _, header := range []string{"abc", "0", "-1", "99999999999999999999", "9101.0", " 9101"} {
		t.Run(header, func(t *testing.T) {
			result := runChannelPin(t, common.RoleAdminUser, true, header, channelPinModel)
			assert.False(t, result.reached)
			assert.Equal(t, http.StatusBadRequest, result.status)
			assert.Contains(t, result.body, i18n.Translate(i18n.LangEn, i18n.MsgDistributorInvalidChannelId))
		})
	}
}

func TestPlaygroundChannelPinRejectsNonAdmin(t *testing.T) {
	setupChannelPinTest(t)

	result := runChannelPin(t, common.RoleCommonUser, true, "9101", channelPinModel)
	assert.False(t, result.reached)
	assert.Equal(t, http.StatusForbidden, result.status)
	assert.Contains(t, result.body, i18n.Translate(i18n.LangEn, i18n.MsgDistributorPinNotAdmin))
}

// Distribute reads the key with a `.(string)` type assertion, so any other type
// panics the request instead of pinning it.
func TestPlaygroundChannelPinStoresChannelIdAsString(t *testing.T) {
	setupChannelPinTest(t)

	result := runChannelPin(t, common.RoleAdminUser, true, "9101", channelPinModel)
	require.True(t, result.reached)
	assert.Equal(t, http.StatusOK, result.status)
	require.True(t, result.pinPresent)
	require.IsType(t, "", result.pinnedTo, "Distribute asserts this value is a string")
	assert.Equal(t, "9101", result.pinnedTo)
}

func TestPlaygroundChannelPinRejectsChannelNotServingModel(t *testing.T) {
	setupChannelPinTest(t)

	result := runChannelPin(t, common.RoleAdminUser, true, "9102", channelPinModel)
	assert.False(t, result.reached)
	assert.Equal(t, http.StatusBadRequest, result.status)
	assert.Contains(t, result.body, channelPinModel)
}

func TestPlaygroundChannelPinRejectsUnknownChannel(t *testing.T) {
	setupChannelPinTest(t)

	result := runChannelPin(t, common.RoleAdminUser, true, "424242", channelPinModel)
	assert.False(t, result.reached)
	assert.Equal(t, http.StatusBadRequest, result.status)
}

// A disabled channel must still reach Distribute, which answers 403
// "channel disabled". Rejecting it here as a model mismatch (its abilities are
// disabled with it) would replace the real reason with a misleading one.
func TestPlaygroundChannelPinDefersDisabledChannelToDistributor(t *testing.T) {
	setupChannelPinTest(t)

	result := runChannelPin(t, common.RoleAdminUser, true, "9103", channelPinModel)
	require.True(t, result.reached)
	assert.Equal(t, "9103", result.pinnedTo)
}

// The echo headers are what the playground reads to name the serving line, and
// scoping them to playground traffic is deliberate: the public relay API must not
// start advertising internal channel ids.
func TestSetupContextForSelectedChannelEchoesChannelOnlyForPlayground(t *testing.T) {
	setupChannelPinTest(t)
	gin.SetMode(gin.TestMode)

	lineCode := "hs4"
	cases := []struct {
		name          string
		trafficSource string
		pin           string
		lineCode      *string
		wantId        string
		wantPinned    string
		wantCode      string
	}{
		{
			name:          "routed playground request",
			trafficSource: trafficSourcePlayground,
			lineCode:      &lineCode,
			wantId:        "9101",
			wantPinned:    "0",
			wantCode:      "hs4",
		},
		{
			name:          "pinned playground request",
			trafficSource: trafficSourcePlayground,
			pin:           "9101",
			lineCode:      &lineCode,
			wantId:        "9101",
			wantPinned:    "1",
			wantCode:      "hs4",
		},
		{
			// A cross-channel retry leaves the pin in context while another line
			// serves the request. Reporting that as pinned would have the header
			// contradict the channel id printed beside it — and "did my pin hold"
			// is the one question this trio exists to answer.
			name:          "playground request retried onto another channel",
			trafficSource: trafficSourcePlayground,
			pin:           "9102",
			lineCode:      &lineCode,
			wantId:        "9101",
			wantPinned:    "0",
			wantCode:      "hs4",
		},
		{
			// No line_code means no line to name; the header must be absent rather
			// than empty so the playground falls back to "#<id>".
			name:          "playground request on a channel with no line",
			trafficSource: trafficSourcePlayground,
			wantId:        "9101",
			wantPinned:    "0",
		},
		{
			name:          "plain relay API request",
			trafficSource: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/pg/chat/completions", strings.NewReader("{}"))
			if tc.trafficSource != "" {
				common.SetContextKey(c, constant.ContextKeyTrafficSource, tc.trafficSource)
			}
			if tc.pin != "" {
				common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, tc.pin)
			}

			channel := &model.Channel{Id: channelPinEnabledId, Type: 1, Key: "k", Name: "pinned",
				Status: common.ChannelStatusEnabled, Models: channelPinModel, Group: "default",
				LineCode: tc.lineCode}
			require.Nil(t, SetupContextForSelectedChannel(c, channel, channelPinModel))

			assert.Equal(t, tc.wantId, c.Writer.Header().Get(HeaderChannelId))
			assert.Equal(t, tc.wantPinned, c.Writer.Header().Get(HeaderChannelPinned))
			assert.Equal(t, tc.wantCode, c.Writer.Header().Get(HeaderChannelCode))
		})
	}
}
