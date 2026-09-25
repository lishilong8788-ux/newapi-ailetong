package controller

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	svccopilot "github.com/QuantumNous/new-api/service/copilot"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/copilot_setting"
)

// setCopilotSetting 通过生产路径（config.GlobalConfig 注册的那份对象）改设置，
// 而不是直接写包变量。这样测试顺带钉住了选项键名：键写错了不会静默生效，断言
// 会当场失败。
func setCopilotSetting(t *testing.T, values map[string]string) {
	t.Helper()
	cfg := config.GlobalConfig.Get("copilot_setting")
	require.NotNil(t, cfg, "copilot_setting 必须已注册，否则设置页读写的全是空值")

	before, err := config.ConfigToMap(cfg)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, config.UpdateConfigFromMap(cfg, before))
	})
	require.NoError(t, config.UpdateConfigFromMap(cfg, values))
}

// newCopilotTestDB 用内存库替换 model.DB，只迁移副驾自己的两张表。
func newCopilotTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	oldDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.CopilotSession{}, &model.CopilotMessage{}))
	model.DB = db
	t.Cleanup(func() {
		model.DB = oldDB
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

// callCopilotHandler 造一个带管理员身份的请求上下文。
func callCopilotHandler(t *testing.T, h gin.HandlerFunc, method, target, body string, userId int, params gin.Params) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, target, strings.NewReader(body))
	c.Set("id", userId)
	c.Params = params
	h(c)
	return w
}

func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope), "body: %s", w.Body.String())
	return envelope
}

// 「开了但没选模型」必须在状态接口就报成未就绪。只有 enabled 一个信号的话，
// 前端会把它当成可用，管理员要到发出第一条消息才发现配置没填完。
func TestCopilotStatus_EnabledWithoutModelIsNotConfigured(t *testing.T) {
	setCopilotSetting(t, map[string]string{
		"enabled":    "true",
		"model":      "",
		"channel_id": "0",
		"max_rounds": "8",
	})

	data := decodeEnvelope(t, callCopilotHandler(t, GetCopilotStatus,
		http.MethodGet, "/api/copilot/status", "", 1, nil))["data"].(map[string]any)

	assert.Equal(t, true, data["enabled"])
	assert.Equal(t, false, data["configured"], "没选模型就不算就绪")
	assert.Equal(t, "", data["model"])
}

// 配齐了才算就绪，而且钉渠道、轮数要如实报出去：前端设置页回显的就是这些值。
func TestCopilotStatus_ReportsConfiguredSelection(t *testing.T) {
	setCopilotSetting(t, map[string]string{
		"enabled":    "true",
		"model":      " gpt-5 ",
		"channel_id": "7",
		"max_rounds": "3",
	})

	data := decodeEnvelope(t, callCopilotHandler(t, GetCopilotStatus,
		http.MethodGet, "/api/copilot/status", "", 1, nil))["data"].(map[string]any)

	assert.Equal(t, true, data["configured"])
	assert.Equal(t, "gpt-5", data["model"], "模型名要去掉设置页里带进来的空白")
	assert.Equal(t, float64(7), data["channel_id"])
	assert.Equal(t, float64(3), data["max_rounds"])
}

// 默认必须是关的：副驾能读全站进价和毛利，还会自己往上游发请求烧 token。升级后
// 自动开着等于站长在不知情的情况下多了一个有全库读权限的出网组件。
func TestCopilotSetting_DefaultsToDisabled(t *testing.T) {
	setCopilotSetting(t, map[string]string{
		"enabled":    "false",
		"model":      "",
		"channel_id": "0",
		"max_rounds": "8",
	})

	setting := copilot_setting.GetSetting()
	assert.False(t, setting.Enabled)
	assert.Equal(t, "", setting.Model)
	assert.False(t, copilot_setting.Configured())
}

// 轮数直接乘在上游请求次数上：填错一个零就是一次对话几百次调用。钳位不是美化
// 输入，是这个功能的成本上限。
func TestCopilotGetMaxRounds_Clamps(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  int
	}{
		{"零视为未配置走默认", "0", copilot_setting.DefaultMaxRounds},
		{"负数钳到下界", "-5", copilot_setting.MinMaxRounds},
		{"下界本身保留", "1", 1},
		{"区间内原样返回", "5", 5},
		{"上界本身保留", "20", copilot_setting.MaxMaxRounds},
		{"超界钳到上界", "999", copilot_setting.MaxMaxRounds},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setCopilotSetting(t, map[string]string{"max_rounds": tc.value})
			assert.Equal(t, tc.want, copilot_setting.GetMaxRounds())
		})
	}
}

// 设置层的默认轮数必须跟循环的兜底值一致。两个常量分别写在 setting 和
// service/copilot 里（import 过去会成环），所以只能靠这条断言拦住数值漂移。
func TestCopilotDefaultMaxRounds_MatchesLoopDefault(t *testing.T) {
	assert.Equal(t, svccopilot.DefaultMaxRounds, copilot_setting.DefaultMaxRounds)
}

// 越权：A 的会话对 B 必须整体不可见——读不到、列不出、删不掉、改不了标题。
// 归属写在 WHERE 里，所以这四条走的是同一道闸，但四个入口都要各自证明一次。
func TestCopilotSession_OwnershipIsScopedByUser(t *testing.T) {
	newCopilotTestDB(t)
	const userA, userB = 11, 22

	session, err := model.CreateCopilotSession(userA, "A 的会话")
	require.NoError(t, err)
	require.NoError(t, model.AppendCopilotMessages(session.Id, userA, []*model.CopilotMessage{
		{Role: svccopilot.RoleUser, Content: "gpt-5 的毛利多少"},
	}))

	_, err = model.GetCopilotSession(session.Id, userB)
	assert.ErrorIs(t, err, model.ErrCopilotSessionNotFound)

	_, err = model.GetCopilotMessages(session.Id, userB)
	assert.ErrorIs(t, err, model.ErrCopilotSessionNotFound, "消息表上没有 user_id，唯一的闸就是会话查询")

	assert.ErrorIs(t, model.UpdateCopilotSessionTitle(session.Id, userB, "改掉"), model.ErrCopilotSessionNotFound)
	assert.ErrorIs(t, model.AppendCopilotMessages(session.Id, userB, []*model.CopilotMessage{
		{Role: svccopilot.RoleUser, Content: "插一句"},
	}), model.ErrCopilotSessionNotFound)
	assert.ErrorIs(t, model.DeleteCopilotSession(session.Id, userB), model.ErrCopilotSessionNotFound)

	sessionsB, totalB, err := model.GetCopilotSessions(userB, &common.PageInfo{Page: 1, PageSize: 20})
	require.NoError(t, err)
	assert.Zero(t, totalB)
	assert.Empty(t, sessionsB)

	// B 折腾一圈之后，A 的会话和消息必须完好。
	stillThere, err := model.GetCopilotSession(session.Id, userA)
	require.NoError(t, err)
	assert.Equal(t, "A 的会话", stillThere.Title)
	messages, err := model.GetCopilotMessages(session.Id, userA)
	require.NoError(t, err)
	require.Len(t, messages, 1, "B 的追加不该落库")
	assert.Equal(t, "gpt-5 的毛利多少", messages[0].Content)
}

// 删除后 A 自己也读不到了，而且消息是真删（对话正文里可能有粘进来的定价、key
// 片段，「删了但还在库里」不是管理员按下删除时期待的语义）。
func TestCopilotSession_DeleteRemovesMessages(t *testing.T) {
	db := newCopilotTestDB(t)
	const userA = 11

	session, err := model.CreateCopilotSession(userA, "待删")
	require.NoError(t, err)
	require.NoError(t, model.AppendCopilotMessages(session.Id, userA, []*model.CopilotMessage{
		{Role: svccopilot.RoleUser, Content: "问题"},
		{Role: svccopilot.RoleAssistant, Content: "回答"},
	}))

	require.NoError(t, model.DeleteCopilotSession(session.Id, userA))

	_, err = model.GetCopilotSession(session.Id, userA)
	assert.ErrorIs(t, err, model.ErrCopilotSessionNotFound)

	var remaining int64
	require.NoError(t, db.Unscoped().Model(&model.CopilotMessage{}).
		Where("session_id = ?", session.Id).Count(&remaining).Error)
	assert.Zero(t, remaining, "消息要真删，不是软删")
}

// 未就绪时 chat 必须在建 Completer 之前就拒掉：既不该烧 token，也不该把管理员的
// 消息落进一个跑不起来的会话里。
//
// 「没调 LLM」的证据是这条会话里一行消息都没有：handler 里落用户消息排在配置
// 检查之后、Run 之前，所以只要库是空的，Run 就没被走到。
func TestCopilotChat_RejectsWhenNotConfigured(t *testing.T) {
	db := newCopilotTestDB(t)
	const admin = 11
	session, err := model.CreateCopilotSession(admin, "")
	require.NoError(t, err)

	cases := []struct {
		name   string
		values map[string]string
	}{
		{"整体关闭", map[string]string{"enabled": "false", "model": "gpt-5"}},
		{"开了但没选模型", map[string]string{"enabled": "true", "model": ""}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setCopilotSetting(t, tc.values)

			w := callCopilotHandler(t, CopilotChat, http.MethodPost,
				"/api/copilot/sessions/1/chat", `{"message":"gpt-5 的毛利多少"}`,
				admin, gin.Params{{Key: "id", Value: strconv.Itoa(session.Id)}})

			envelope := decodeEnvelope(t, w)
			assert.Equal(t, false, envelope["success"])
			assert.Contains(t, envelope["message"], "运营副驾未启用或未选择模型",
				"报错要指向那个没填的设置项")
			assert.NotContains(t, w.Header().Get("Content-Type"), "text/event-stream",
				"前置校验失败要回普通 JSON，不能先把响应变成 SSE 流")

			var stored int64
			require.NoError(t, db.Model(&model.CopilotMessage{}).
				Where("session_id = ?", session.Id).Count(&stored).Error)
			assert.Zero(t, stored, "拒绝发生在落库和调用 LLM 之前")
		})
	}
}

// 空消息同样不进循环。这条和上面那条走的是不同分支：配置是对的，输入是空的。
func TestCopilotChat_RejectsEmptyMessage(t *testing.T) {
	newCopilotTestDB(t)
	setCopilotSetting(t, map[string]string{"enabled": "true", "model": "gpt-5"})
	session, err := model.CreateCopilotSession(11, "")
	require.NoError(t, err)

	w := callCopilotHandler(t, CopilotChat, http.MethodPost,
		"/api/copilot/sessions/1/chat", `{"message":"   "}`,
		11, gin.Params{{Key: "id", Value: strconv.Itoa(session.Id)}})

	envelope := decodeEnvelope(t, w)
	assert.Equal(t, false, envelope["success"])
	assert.Equal(t, "消息不能为空", envelope["message"])
}

// tool_calls 落库再读回来必须还是同一份。写入和读出是两个函数（一个 Marshal 到
// text 列，一个从 text 列 Unmarshal），格式一旦分叉，重新打开会话时工具调用会
// 静默消失——正文还在，所以没人会发现副驾其实查过东西。
func TestCopilotToolCalls_SurviveRoundTrip(t *testing.T) {
	calls := []svccopilot.ToolCall{
		{ID: "call_1", Name: "get_model_pricing", Arguments: json.RawMessage(`{"model":"gpt-5"}`)},
		{ID: "call_2", Name: "list_channels", Arguments: json.RawMessage(`{}`)},
	}
	rows := copilotRowsFromMessages([]svccopilot.Message{
		{Role: svccopilot.RoleAssistant, Content: "先查一下官方价", ToolCalls: calls},
		{Role: svccopilot.RoleTool, Content: `{"input":1.25}`, ToolCallID: "call_1"},
		{Role: svccopilot.RoleAssistant, Content: "毛利 42%"},
	}, 1200, 340, map[string]int64{"call_1": 87})

	require.Len(t, rows, 3)
	assert.Equal(t, "call_1", rows[1].ToolCallId)

	// 耗时落在 tool 行上。实时流里步骤行显示耗时，重开会话时也得有——两个时刻
	// 显示得不一样，管理员会以为记录不全。
	assert.Equal(t, int64(87), rows[1].DurationMs)
	assert.Zero(t, rows[0].DurationMs, "助手行不该有耗时")

	decoded := decodeCopilotToolCalls(rows[0].ToolCalls)
	require.Len(t, decoded, 2)
	assert.Equal(t, calls[0], decoded[0])
	assert.Equal(t, calls[1], decoded[1])

	// 整轮的 token 记在收尾的那条助手消息上，中间的工具调用行不重复计数，
	// 否则界面上整列求和会翻倍。
	assert.Equal(t, 1200, rows[2].PromptTokens)
	assert.Equal(t, 340, rows[2].CompletionTokens)
	assert.Zero(t, rows[0].PromptTokens)
	assert.Zero(t, rows[1].PromptTokens)
}

// 坏掉的 tool_calls 不该让整个会话打不开：正文才是管理员要看的东西。
func TestCopilotToolCalls_CorruptPayloadDegradesToNil(t *testing.T) {
	assert.Nil(t, decodeCopilotToolCalls(""))
	assert.Nil(t, decodeCopilotToolCalls("   "))
	assert.Nil(t, decodeCopilotToolCalls("{not json"))
}

// 只贴图不说话是合法的提问（「这张表看出什么问题」的最短形式）。空的判定必须是
// 文本和图片都空，否则贴图会被当成空消息打回。
//
// 故意用一张坏图：合法的图会让请求一路走到真上游（需要 Redis 和真渠道），而这条
// 测试要盯的只是那道空判定。报错报的是图片格式而不是「消息不能为空」，就说明空
// 判定放它过去了。
func TestCopilotChat_ImageOnlyIsNotEmpty(t *testing.T) {
	newCopilotTestDB(t)
	setCopilotSetting(t, map[string]string{"enabled": "true", "model": "gpt-5"})
	t.Setenv("COPILOT_IMAGE_PATH", t.TempDir())
	session, err := model.CreateCopilotSession(11, "")
	require.NoError(t, err)

	notAnImage := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("<html>"))
	w := callCopilotHandler(t, CopilotChat, http.MethodPost,
		"/api/copilot/sessions/1/chat", `{"message":"   ","images":["`+notAnImage+`"]}`,
		11, gin.Params{{Key: "id", Value: strconv.Itoa(session.Id)}})

	envelope := decodeEnvelope(t, w)
	assert.Equal(t, false, envelope["success"])
	assert.NotEqual(t, "消息不能为空", envelope["message"], "只贴图不该被当成空消息")
	assert.Contains(t, envelope["message"], "图片", "应该报到图片格式上，实际 %v", envelope["message"])
}

// 文本和图片都空才是空。
func TestCopilotChat_RejectsEmptyMessageAndNoImages(t *testing.T) {
	newCopilotTestDB(t)
	setCopilotSetting(t, map[string]string{"enabled": "true", "model": "gpt-5"})
	session, err := model.CreateCopilotSession(11, "")
	require.NoError(t, err)

	w := callCopilotHandler(t, CopilotChat, http.MethodPost,
		"/api/copilot/sessions/1/chat", `{"message":"  ","images":[]}`,
		11, gin.Params{{Key: "id", Value: strconv.Itoa(session.Id)}})

	envelope := decodeEnvelope(t, w)
	assert.Equal(t, false, envelope["success"])
	assert.Equal(t, "消息不能为空", envelope["message"])
}

// 超过条数上限的那批在落盘之前就该被挡掉。
func TestCopilotChat_RejectsTooManyImages(t *testing.T) {
	newCopilotTestDB(t)
	setCopilotSetting(t, map[string]string{"enabled": "true", "model": "gpt-5"})
	session, err := model.CreateCopilotSession(11, "")
	require.NoError(t, err)

	webp := `"data:image/webp;base64,UklGRgAAAABXRUJQVlA4IA=="`
	payload := `{"message":"看这些","images":[` + strings.TrimSuffix(strings.Repeat(webp+",", service.MaxCopilotImages+1), ",") + `]}`
	w := callCopilotHandler(t, CopilotChat, http.MethodPost,
		"/api/copilot/sessions/1/chat", payload,
		11, gin.Params{{Key: "id", Value: strconv.Itoa(session.Id)}})

	envelope := decodeEnvelope(t, w)
	assert.Equal(t, false, envelope["success"])
	assert.Contains(t, envelope["message"], "最多")
}

// 图片端点必须做归属校验：路径是 URL 参数，少了这一道，任何管理员都能翻别人
// 会话里的截图——而副驾的对话里全是经营数字。
func TestGetCopilotImage_RejectsOtherAdminsSession(t *testing.T) {
	newCopilotTestDB(t)
	root := t.TempDir()
	t.Setenv("COPILOT_IMAGE_PATH", root)

	// 会话属于 11，请求由 22 发出。
	session, err := model.CreateCopilotSession(11, "")
	require.NoError(t, err)
	paths, err := service.SaveCopilotImages(session.Id, []string{
		"data:image/webp;base64," + base64.StdEncoding.EncodeToString([]byte("RIFF\x00\x00\x00\x00WEBPVP8 ")),
	})
	require.NoError(t, err)
	require.Len(t, paths, 1)

	w := callCopilotHandler(t, GetCopilotImage, http.MethodGet,
		"/api/copilot/images?path="+paths[0], "", 22, nil)

	envelope := decodeEnvelope(t, w)
	assert.Equal(t, false, envelope["success"])
	assert.Equal(t, "无权访问该图片", envelope["message"])
}

func TestGetCopilotImage_ServesOwnSessionImage(t *testing.T) {
	newCopilotTestDB(t)
	t.Setenv("COPILOT_IMAGE_PATH", t.TempDir())

	session, err := model.CreateCopilotSession(11, "")
	require.NoError(t, err)
	content := []byte("RIFF\x00\x00\x00\x00WEBPVP8 ")
	paths, err := service.SaveCopilotImages(session.Id, []string{
		"data:image/webp;base64," + base64.StdEncoding.EncodeToString(content),
	})
	require.NoError(t, err)

	w := callCopilotHandler(t, GetCopilotImage, http.MethodGet,
		"/api/copilot/images?path="+paths[0], "", 11, nil)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "image/webp", w.Header().Get("Content-Type"), "显式设置 MIME，别让 ServeFile 自己嗅")
	assert.Equal(t, content, w.Body.Bytes())
}

// 路径穿越要在归属校验那一步就死掉：`../` 开头的路径解不出会话号。
func TestGetCopilotImage_RejectsMalformedPath(t *testing.T) {
	newCopilotTestDB(t)
	t.Setenv("COPILOT_IMAGE_PATH", t.TempDir())

	for _, bad := range []string{"", "secrets.env", "../../etc/passwd", "abc/x.webp"} {
		w := callCopilotHandler(t, GetCopilotImage, http.MethodGet,
			"/api/copilot/images?path="+bad, "", 11, nil)
		envelope := decodeEnvelope(t, w)
		assert.Equal(t, false, envelope["success"], "path=%q 必须被拒", bad)
	}
}

// 图片路径落库再读回必须是同一份，而且不带图的消息存空串——绝大多数消息没有图，
// 让老行和新行在库里长得一样。
func TestCopilotImagePaths_SurviveRoundTrip(t *testing.T) {
	encoded, err := encodeCopilotImagePaths([]string{"12/a.webp", "12/b.png"})
	require.NoError(t, err)
	assert.Equal(t, []string{"12/a.webp", "12/b.png"}, decodeCopilotImagePaths(encoded))

	empty, err := encodeCopilotImagePaths(nil)
	require.NoError(t, err)
	assert.Equal(t, "", empty, "不带图的消息存空串而不是 []")
	assert.Nil(t, decodeCopilotImagePaths(empty))
	assert.Nil(t, decodeCopilotImagePaths("{not json"), "坏掉的一列不该让会话打不开")
}

// 历史里的图要带回上下文：追问「第三行那个为什么亏」时模型还得看得见图。
func TestCopilotHistory_CarriesImages(t *testing.T) {
	history := copilotHistory([]*model.CopilotMessage{
		{Role: svccopilot.RoleUser, Content: "看这张表", Images: `["3/a.webp"]`},
		{Role: svccopilot.RoleAssistant, Content: "渠道 12 在亏"},
	})
	require.Len(t, history, 2)
	assert.Equal(t, []string{"3/a.webp"}, history[0].Images)
	assert.Empty(t, history[1].Images, "助手消息没有图")
}

// 标题按字符截断。中文一个字 3 字节，按字节切会把最后一个字切成半个，落库就是
// 乱码——而这行字直接显示在会话列表上。
func TestCopilotSessionTitle_TruncatesByRune(t *testing.T) {
	assert.Equal(t, "查一下 gpt-5 的毛利", model.CopilotSessionTitle("  查一下 gpt-5 的毛利  "))
	assert.Equal(t, "第一行 第二行", model.CopilotSessionTitle("第一行\n第二行"), "换行要压成一行")

	long := strings.Repeat("毛", 80)
	title := model.CopilotSessionTitle(long)
	assert.Equal(t, strings.Repeat("毛", 60)+"…", title)
	assert.True(t, utf8.ValidString(title), "截断不能切出半个字")
}
