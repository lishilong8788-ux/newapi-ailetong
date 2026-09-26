package copilot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 问答模式（以及任何非 act 的值）不能拿到写工具。空字符串那一条是给老客户端的：
// 它们压根不发 mode，升级后台不该让它们凭空获得写能力。
func TestBuildRegistryForMode_WithholdsWritesOutsideAct(t *testing.T) {
	for _, mode := range []string{ModeAsk, "", "qa", "ACT", "anything"} {
		t.Run("mode="+mode, func(t *testing.T) {
			for _, tool := range BuildRegistryForMode(mode).List() {
				assert.False(t, tool.Mutates, "%q 模式不该暴露写工具 %q", mode, tool.Name)
			}
		})
	}
}

func TestBuildRegistryForMode_ActExposesWrites(t *testing.T) {
	tools := BuildRegistryForMode(ModeAct).List()

	var mutating []string
	for _, tool := range tools {
		if tool.Mutates {
			mutating = append(mutating, tool.Name)
		}
	}
	assert.Equal(t, []string{"set_channel_markup"}, mutating)

	// 只读那九个必须还在：act 模式是「多了写能力」，不是「换了一套工具」。
	assert.Len(t, tools, len(BuildRegistry().List())+1)
}

// 每个写工具都必须标 Mutates。闸门判的就是这个字段，漏标等于这个工具绕过确认
// 直接写库 —— 而且是静默的，没有任何报错会提示它。
func TestWriteTools_AllDeclareMutates(t *testing.T) {
	tools := writeTools()
	require.NotEmpty(t, tools)
	for _, tool := range tools {
		t.Run(tool.Name, func(t *testing.T) {
			assert.True(t, tool.Mutates, "写工具必须标 Mutates，否则绕过确认闸门")
			assert.NotEmpty(t, tool.Description)
			require.NotNil(t, tool.Handler)
			require.NotNil(t, tool.Parameters)
		})
	}
}

// 拿到批准不等于拿到了合法参数：批准只带工具名，参数值是模型在同一轮里自己填的。
// 所以边界校验必须在 handler 里，而不是只在闸门前。这几条都在碰库之前就该失败。
func TestHandleSetChannelMarkup_RejectsBadArgsBeforeTouchingDB(t *testing.T) {
	cases := []struct {
		name string
		args string
	}{
		{name: "markup 省略", args: `{"channel_id": 3}`},
		{name: "markup 为负", args: `{"channel_id": 3, "markup": -0.1}`},
		{name: "markup 超上界", args: `{"channel_id": 3, "markup": 100.1}`},
		{name: "渠道 id 为零", args: `{"channel_id": 0, "markup": 0.3}`},
		{name: "渠道 id 为负", args: `{"channel_id": -1, "markup": 0.3}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := handleSetChannelMarkup(context.Background(), []byte(tc.args))
			require.Error(t, err)
			assert.Nil(t, result)
		})
	}
}

// markup = 0 是合法值，含义是平进平出。把 0 当「没配」是这个代码库踩过的 bug 形状，
// 所以单独钉一条：写工具和模拟工具共用的这份校验必须放行 0。
//
// 只验校验层，不驱动 handler：再往下就是取渠道写库，那需要一整套 DB fixture，
// 而它验的是 GORM 能不能连上，不是这里要保护的契约。
func TestValidateSimulateMarkup_AcceptsZero(t *testing.T) {
	require.NoError(t, validateSimulateMarkup(0), "0 是平进平出，合法")
	require.NoError(t, validateSimulateMarkup(maxSimulateMarkup), "上界本身应当合法")
	assert.Error(t, validateSimulateMarkup(-0.01))
	assert.Error(t, validateSimulateMarkup(maxSimulateMarkup+0.01))
}
