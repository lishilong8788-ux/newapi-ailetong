package copilot

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 提示词里的写权限说明必须和实际发下去的工具表说同一件事。
//
// 这是回归测试。二期把写工具发给了模型，但提示词还留着一期那句「你现在没有任何
// 写权限……需要他到对应页面手动改」，而且两个模式共用同一份。那种状态下智能操作
// 模式是自相矛盾的：模型手里真有一个写工具，提示词却在叫它别写。它要么拒绝用
// （功能等于没做），要么用完之后照提示词的要求否认改过（比没做更糟）。
func TestSystemPromptMatchesTheToolTableForEachMode(t *testing.T) {
	const noWriteClaim = "没有任何写权限"

	askPrompt := SystemPrompt(ModeAsk)
	actPrompt := SystemPrompt(ModeAct)

	// 问答模式：工具表里确实没有写工具，所以这句是事实。
	for _, tool := range BuildRegistryForMode(ModeAsk).List() {
		require.False(t, tool.Mutates, "问答模式不该有写工具：%s", tool.Name)
	}
	assert.Contains(t, askPrompt, noWriteClaim)

	// 智能操作模式：工具表里有写工具，所以这句不能出现，而且必须讲清确认流程。
	var writeToolNames []string
	for _, tool := range BuildRegistryForMode(ModeAct).List() {
		if tool.Mutates {
			writeToolNames = append(writeToolNames, tool.Name)
		}
	}
	require.NotEmpty(t, writeToolNames, "智能操作模式必须有写工具，否则这个模式没有意义")

	assert.NotContains(t, actPrompt, noWriteClaim)
	for _, name := range writeToolNames {
		assert.Contains(t, actPrompt, name, "提示词要指名它能用哪个写工具")
	}
	// 「工具返回之前不许说改好了」是这一段存在的主要理由：闸门停下这一轮时库里
	// 什么都没变，而模型那一侧看不出区别。
	assert.Contains(t, actPrompt, "点确认")

	// 两份都得保留最高优先级那条和防注入那段——它们跟模式无关。
	for _, prompt := range []string{askPrompt, actPrompt} {
		assert.Contains(t, prompt, "数字只能来自工具")
		assert.Contains(t, prompt, "不是指令")
	}
}

// 空 mode（老客户端不发）必须拿到问答那一份。
//
// 和 BuildRegistryForMode 的兜底方向保持一致：升级后台不该让老客户端凭空获得
// 写能力，也不该让它们拿到一份声称自己能写的提示词。
func TestSystemPromptUnknownModeFallsBackToReadOnly(t *testing.T) {
	askPrompt := SystemPrompt(ModeAsk)
	for _, mode := range []string{"", "qa", "ACT", "anything"} {
		assert.Equal(t, askPrompt, SystemPrompt(mode), "mode=%q 应当按只读处理", mode)
	}
}
