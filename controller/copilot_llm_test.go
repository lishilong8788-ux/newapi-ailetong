package controller

import (
	"encoding/base64"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// relayCompleter 整体要真库真渠道才能跑，但它内部这几个纯函数是副驾唯一「第一条
// 消息就会踩到」的代码，全部走模型给的原始串——上游给什么形状都得接住。

// 空参调用各家上游给的形状不一样（""、"  "、"{}"），得统一成 {}，否则工具 handler
// 的 Unmarshal 会在「模型其实没传参」这种最平常的情况下报错。
func TestCopilotToolArguments_NormalizesEmpty(t *testing.T) {
	for _, raw := range []string{"", "   ", "\n\t"} {
		assert.JSONEq(t, `{}`, string(copilotToolArguments(raw)), "raw=%q", raw)
	}
}

func TestCopilotToolArguments_PassesThroughObject(t *testing.T) {
	out := copilotToolArguments(`{"model":"gpt-5","days":7}`)
	assert.JSONEq(t, `{"model":"gpt-5","days":7}`, string(out))
}

// 非 JSON 串包成 JSON 字符串而不是丢掉：工具 handler 会 Unmarshal 失败并把错误喂回
// 模型，模型能自己改对；直接丢会让它以为参数传成功了。
func TestCopilotToolArguments_WrapsInvalidJSON(t *testing.T) {
	out := string(copilotToolArguments(`{not json`))
	assert.True(t, strings.HasPrefix(out, `"`), "应包成 JSON 字符串，实际 %s", out)
	assert.Contains(t, out, "not json")
}

// 合法但不是对象的 JSON（null / 数字 / 裸字符串 / 数组）。模型偶尔会用这些形状表示
// 「没有参数」，而所有工具 handler 都按对象 Unmarshal。这里记录当前真实行为：
// gjson.Valid 认它们合法所以原样放行，Unmarshal 到 struct 时失败，错误回喂给模型。
//
// 不算 bug（降级方向是对的：报错回模型而不是当成空参静默跑一次全量查询），但
// null 有例外——encoding/json 把 null 解进 struct 是成功的且不改任何字段，于是它
// 等价于「空参」，这恰好也是模型的本意。所以只有 null 值得单独钉住。
func TestCopilotToolArguments_ValidNonObjectPassesThrough(t *testing.T) {
	type toolArgs struct {
		Model string `json:"model"`
		Days  int    `json:"days"`
	}

	for _, raw := range []string{"null", "123", `"gpt-5"`, `[1,2]`} {
		assert.Equal(t, raw, string(copilotToolArguments(raw)), "raw=%q 应原样放行", raw)
	}

	// null 等价空参：解进 struct 成功，字段一个都不动。
	got := toolArgs{Model: "untouched", Days: 7}
	require.NoError(t, common.Unmarshal(copilotToolArguments("null"), &got))
	assert.Equal(t, toolArgs{Model: "untouched", Days: 7}, got)

	// 其余三种解不进对象，工具 handler 会把错误回喂模型让它改对——降级方向是对的，
	// 比当成空参静默跑一次全量查询好。
	for _, raw := range []string{"123", `"gpt-5"`, `[1,2]`} {
		var into toolArgs
		assert.Error(t, common.Unmarshal(copilotToolArguments(raw), &into), "raw=%q", raw)
	}
}

func TestCopilotUpstreamErrorText_PrefersOpenAIMessage(t *testing.T) {
	body := []byte(`{"error":{"message":"channel 7 unauthorized","type":"invalid_request_error"}}`)
	assert.Equal(t, "channel 7 unauthorized", copilotUpstreamErrorText(body))
}

// 不是 OpenAI 错误信封时不能吞掉原文：管理员靠这段话分辨「副驾自己的渠道挂了」
// 还是「问的那个模型有问题」。
func TestCopilotUpstreamErrorText_FallsBackToRawBody(t *testing.T) {
	assert.Equal(t, "502 Bad Gateway", copilotUpstreamErrorText([]byte("  502 Bad Gateway  ")))
	assert.Equal(t, "上游未返回响应体", copilotUpstreamErrorText(nil))
	assert.Equal(t, "上游未返回响应体", copilotUpstreamErrorText([]byte{}))
}

// 截断按 rune 而不是 byte：上游错误里带中文很常见，按字节切会把最后一个字切成半个，
// 直接显示在管理员的界面上就是乱码。
func TestTruncateForCopilot_CutsByRune(t *testing.T) {
	long := strings.Repeat("渠", copilotErrorBodyPreviewRunes+50)
	out := truncateForCopilot(long)

	require.True(t, strings.HasSuffix(out, "…（已截断）"))
	head := strings.TrimSuffix(out, "…（已截断）")
	assert.Equal(t, copilotErrorBodyPreviewRunes, len([]rune(head)))
	assert.True(t, utf8.ValidString(head), "截断后必须仍是合法 UTF-8")

	assert.Equal(t, "短文本", truncateForCopilot("  短文本  "), "未超长只去空白")
}

// 带图的消息要变成 [文本, 图片...] 的多模态数组，图片以 data URL 内联。
// 不给 URL：图片存在挂着 AdminAuth 的端点后面，上游服务器取不到。
func TestCopilotImageContent_TextFirstThenImages(t *testing.T) {
	root := t.TempDir()
	t.Setenv("COPILOT_IMAGE_PATH", root)

	saved, err := service.SaveCopilotImages(5, []string{
		"data:image/webp;base64," + base64.StdEncoding.EncodeToString([]byte("RIFF\x00\x00\x00\x00WEBPVP8 ")),
	})
	require.NoError(t, err)
	require.Len(t, saved, 1)

	parts := copilotImageContent("这张表哪条渠道在亏钱", saved)
	require.Len(t, parts, 2)

	// 文本在前：图片之后紧跟的文字，有的上游会当成图片说明而不是提问。
	assert.Equal(t, dto.ContentTypeText, parts[0].Type)
	assert.Equal(t, "这张表哪条渠道在亏钱", parts[0].Text)

	assert.Equal(t, dto.ContentTypeImageURL, parts[1].Type)
	image, ok := parts[1].ImageUrl.(*dto.MessageImageUrl)
	require.True(t, ok, "必须是 *MessageImageUrl —— GetImageMedia 不认值类型，会静默丢图")
	assert.True(t, strings.HasPrefix(image.Url, "data:image/webp;base64,"), "实际 %q", image.Url)
}

// 只贴图不说话：不能凭空造一段文本出来，那会变成模型眼里管理员说过的话。
func TestCopilotImageContent_OmitsEmptyText(t *testing.T) {
	root := t.TempDir()
	t.Setenv("COPILOT_IMAGE_PATH", root)

	saved, err := service.SaveCopilotImages(6, []string{
		"data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00}),
	})
	require.NoError(t, err)

	parts := copilotImageContent("   ", saved)
	require.Len(t, parts, 1)
	assert.Equal(t, dto.ContentTypeImageURL, parts[0].Type)
}

// 读不到的图跳过，但必须在文本里留痕：静默跳过会让模型对着看不见的图编内容，
// 而这是个要拿数字做决策的运营副驾。
func TestCopilotImageContent_MissingImageIsDisclosed(t *testing.T) {
	t.Setenv("COPILOT_IMAGE_PATH", t.TempDir())

	parts := copilotImageContent("第三行为什么亏", []string{"9/gone.webp"})
	require.Len(t, parts, 1, "图读不到就只剩文本")
	assert.Equal(t, dto.ContentTypeText, parts[0].Type)
	assert.Contains(t, parts[0].Text, "第三行为什么亏", "原来的提问要留着")
	assert.Contains(t, parts[0].Text, "无法读取", "要告诉模型有图丢了")
}
