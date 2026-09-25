package copilot

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// scriptedCompleter 按脚本逐轮返回预设响应，并记录它实际看到的消息列表。
// 脚本走完后再被调用就报错——这样"循环多问了一轮"会失败而不是静默重放。
type scriptedCompleter struct {
	script    []CompletionResponse
	calls     int
	seen      [][]Message
	tools     []Tool
	model     string
	channelID int
}

func (s *scriptedCompleter) Complete(_ context.Context, req CompletionRequest) (*CompletionResponse, error) {
	s.calls++
	// 拷一份再存：循环手里的那个切片后面还要继续 append，直接留切片头会让断言依赖
	// 底层数组有没有扩容这种无关细节。
	s.seen = append(s.seen, append([]Message(nil), req.Messages...))
	s.tools = req.Tools
	s.model = req.Model
	s.channelID = req.ChannelID
	if s.calls > len(s.script) {
		return nil, errors.New("completer called more times than the script has responses")
	}
	resp := s.script[s.calls-1]
	return &resp, nil
}

// alwaysToolCompleter 每轮都要求调同一个工具，永不收口。用来验证轮数上限。
type alwaysToolCompleter struct {
	calls int
}

func (a *alwaysToolCompleter) Complete(_ context.Context, _ CompletionRequest) (*CompletionResponse, error) {
	a.calls++
	return &CompletionResponse{
		ToolCalls: []ToolCall{{
			ID:        "call-loop",
			Name:      "get_price",
			Arguments: json.RawMessage(`{}`),
		}},
		PromptTokens:     10,
		CompletionTokens: 1,
	}, nil
}

func newTestRegistry(t *testing.T) *Registry {
	t.Helper()
	r := NewRegistry()
	r.Register(Tool{
		Name:        "get_price",
		Description: "查模型平台价",
		Parameters:  map[string]any{"type": "object"},
		Handler: func(_ context.Context, args json.RawMessage) (any, error) {
			return map[string]any{"model_ratio": 2.5, "echo": string(args)}, nil
		},
	})
	r.Register(Tool{
		Name:        "get_cost",
		Description: "查渠道进价",
		Handler: func(_ context.Context, _ json.RawMessage) (any, error) {
			return nil, errors.New("cost snapshot missing for channel 7")
		},
	})
	r.Register(Tool{
		Name:        "no_handler",
		Description: "注册了但没实现",
	})
	return r
}

// collectEvents 收集事件，并可在第 stopAt 条事件（1-based）上返回 error 模拟客户端断开。
func collectEvents(events *[]Event, stopAt int, stopErr error) Emit {
	return func(e Event) error {
		*events = append(*events, e)
		if stopAt > 0 && len(*events) == stopAt {
			return stopErr
		}
		return nil
	}
}

func eventTypes(events []Event) []string {
	out := make([]string, 0, len(events))
	for _, e := range events {
		out = append(out, e.Type)
	}
	return out
}

func TestRunSingleToolCallThenFinalAnswer(t *testing.T) {
	completer := &scriptedCompleter{script: []CompletionResponse{
		{
			Content: "先查一下这个模型的平台价。",
			ToolCalls: []ToolCall{{
				ID:        "call-1",
				Name:      "get_price",
				Arguments: json.RawMessage(`{"model":"gpt-5"}`),
			}},
			PromptTokens:     100,
			CompletionTokens: 20,
		},
		{
			Content:          "平台倍率 2.5（每 1M token 5 美元）。",
			PromptTokens:     150,
			CompletionTokens: 30,
		},
	}}

	var events []Event
	msgs, err := Run(context.Background(), RunOptions{
		Completer: completer,
		Registry:  newTestRegistry(t),
		Model:     "gpt-5",
		History:   []Message{{Role: RoleUser, Content: "上一轮"}, {Role: RoleAssistant, Content: "上一轮回答"}},
		UserInput: "gpt-5 现在什么价？",
	}, collectEvents(&events, 0, nil))

	require.NoError(t, err)
	require.Equal(t, 2, completer.calls)

	// 返回的只有模型这一轮产出的消息：带工具调用的助手消息、工具结果、最终回答。
	// 用户输入不在里面 —— 调用方在开流前已经把它落了库，返一份会让同一句话在会话
	// 里出现两次。system prompt 与 History 同理不返。
	require.Len(t, msgs, 3)
	assert.Equal(t, RoleAssistant, msgs[0].Role)
	assert.Equal(t, "先查一下这个模型的平台价。", msgs[0].Content)
	require.Len(t, msgs[0].ToolCalls, 1)
	assert.Equal(t, "call-1", msgs[0].ToolCalls[0].ID)
	assert.Equal(t, RoleTool, msgs[1].Role)
	assert.Equal(t, "call-1", msgs[1].ToolCallID)
	assert.JSONEq(t, `{"model_ratio":2.5,"echo":"{\"model\":\"gpt-5\"}"}`, msgs[1].Content)
	assert.Equal(t, Message{Role: RoleAssistant, Content: "平台倍率 2.5（每 1M token 5 美元）。"}, msgs[2])
	for i, msg := range msgs {
		assert.NotEqual(t, RoleUser, msg.Role, "msgs[%d]：用户消息由调用方自己落库，循环不能再返一份", i)
		assert.NotEqual(t, RoleSystem, msg.Role, "msgs[%d]：system prompt 每轮重新生成，不入库", i)
	}

	// 模型第二次被调用时必须看到完整上下文：system + 2 条 History + 用户输入 +
	// 助手工具调用 + 工具结果 = 6 条。少一条就是把工具结果喂丢了。
	require.Len(t, completer.seen, 2)
	assert.Equal(t, RoleSystem, completer.seen[0][0].Role)
	assert.NotEmpty(t, completer.seen[0][0].Content)
	require.Len(t, completer.seen[1], 6)
	assert.Equal(t, RoleTool, completer.seen[1][5].Role)

	assert.Equal(t, []string{
		EventText, EventToolStart, EventToolEnd, EventText, EventUsage, EventDone,
	}, eventTypes(events))

	assert.Equal(t, "get_price", events[1].ToolName)
	assert.Equal(t, "call-1", events[1].ToolCallID)
	assert.JSONEq(t, `{"model":"gpt-5"}`, string(events[1].ToolArgs))
	assert.True(t, events[2].OK)
	assert.Empty(t, events[2].ErrorText)
	assert.Equal(t, 250, events[4].PromptTokens)
	assert.Equal(t, 50, events[4].CompletionTokens)
}

func TestRunFeedsToolFailureBackToModel(t *testing.T) {
	cases := []struct {
		name      string
		toolName  string
		wantError string
	}{
		{
			name:      "handler returns error",
			toolName:  "get_cost",
			wantError: "cost snapshot missing for channel 7",
		},
		{
			name:      "tool not in registry",
			toolName:  "get_margin_by_vibes",
			wantError: `unknown tool "get_margin_by_vibes"`,
		},
		{
			name:      "tool registered without handler",
			toolName:  "no_handler",
			wantError: `tool "no_handler" has no handler`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			completer := &scriptedCompleter{script: []CompletionResponse{
				{ToolCalls: []ToolCall{{ID: "call-1", Name: tc.toolName, Arguments: json.RawMessage(`{}`)}}},
				{Content: "查不到进价，请先同步渠道成本。"},
			}}

			var events []Event
			msgs, err := Run(context.Background(), RunOptions{
				Completer: completer,
				Registry:  newTestRegistry(t),
				UserInput: "7 号渠道的毛利多少？",
			}, collectEvents(&events, 0, nil))

			// 工具失败不终止整轮：错误写成 tool 结果喂回模型，模型还能解释。
			require.NoError(t, err)
			assert.Equal(t, 2, completer.calls)

			require.Len(t, msgs, 3)
			assert.Equal(t, RoleTool, msgs[1].Role)
			var payload map[string]string
			require.NoError(t, common.UnmarshalJsonStr(msgs[1].Content, &payload))
			assert.Equal(t, tc.wantError, payload["error"])
			assert.Equal(t, "查不到进价，请先同步渠道成本。", msgs[2].Content)

			// 第一轮助手消息没有文本，所以不发 EventText。
			assert.Equal(t, []string{
				EventToolStart, EventToolEnd, EventText, EventUsage, EventDone,
			}, eventTypes(events))
			assert.False(t, events[1].OK)
			assert.Equal(t, tc.wantError, events[1].ErrorText)
		})
	}
}

func TestRunStopsAtMaxRounds(t *testing.T) {
	completer := &alwaysToolCompleter{}

	var events []Event
	msgs, err := Run(context.Background(), RunOptions{
		Completer: completer,
		Registry:  newTestRegistry(t),
		MaxRounds: 3,
		UserInput: "一直查",
	}, collectEvents(&events, 0, nil))

	// 撞上限是正常结局，不是 error：管理员要看到已查到的部分加一句说明。
	require.NoError(t, err)
	assert.Equal(t, 3, completer.calls)

	// 3×(助手工具调用 + 工具结果) + 上限说明。
	require.Len(t, msgs, 7)
	assert.Equal(t, RoleAssistant, msgs[6].Role)
	assert.Empty(t, msgs[6].ToolCalls)
	assert.Contains(t, msgs[6].Content, "3")

	assert.Equal(t, []string{
		EventToolStart, EventToolEnd,
		EventToolStart, EventToolEnd,
		EventToolStart, EventToolEnd,
		EventText, EventUsage, EventDone,
	}, eventTypes(events))
	assert.Equal(t, 30, events[7].PromptTokens)
	assert.Equal(t, 3, events[7].CompletionTokens)
}

func TestRunDefaultsMaxRoundsWhenUnset(t *testing.T) {
	completer := &alwaysToolCompleter{}

	var events []Event
	_, err := Run(context.Background(), RunOptions{
		Completer: completer,
		Registry:  newTestRegistry(t),
		UserInput: "一直查",
	}, collectEvents(&events, 0, nil))

	require.NoError(t, err)
	assert.Equal(t, DefaultMaxRounds, completer.calls)
}

func TestRunStopsWhenEmitFails(t *testing.T) {
	disconnected := errors.New("client disconnected")

	cases := []struct {
		name          string
		stopAt        int
		wantCompletes int
		wantEvents    []string
	}{
		{
			// 第一条 EventText 就断开：模型只能被问一次，不许再烧第二轮 token。
			name:          "stops on first text event",
			stopAt:        1,
			wantCompletes: 1,
			wantEvents:    []string{EventText},
		},
		{
			// tool_start 断开：工具不再执行，也不再问模型。
			name:          "stops on tool start event",
			stopAt:        2,
			wantCompletes: 1,
			wantEvents:    []string{EventText, EventToolStart},
		},
		{
			// tool_end 断开：工具已经跑完，但不再问第二轮。
			name:          "stops on tool end event",
			stopAt:        3,
			wantCompletes: 1,
			wantEvents:    []string{EventText, EventToolStart, EventToolEnd},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			completer := &scriptedCompleter{script: []CompletionResponse{
				{
					Content:   "先查平台价。",
					ToolCalls: []ToolCall{{ID: "call-1", Name: "get_price", Arguments: json.RawMessage(`{}`)}},
				},
				{Content: "不该走到这一轮"},
			}}

			var events []Event
			_, err := Run(context.Background(), RunOptions{
				Completer: completer,
				Registry:  newTestRegistry(t),
				UserInput: "查价",
			}, collectEvents(&events, tc.stopAt, disconnected))

			require.ErrorIs(t, err, disconnected)
			assert.Equal(t, tc.wantCompletes, completer.calls)
			assert.Equal(t, tc.wantEvents, eventTypes(events))
		})
	}
}

func TestRunPassesRegistryToolsAndChannelPin(t *testing.T) {
	completer := &scriptedCompleter{script: []CompletionResponse{{Content: "好"}}}

	var events []Event
	_, err := Run(context.Background(), RunOptions{
		Completer: completer,
		Registry:  newTestRegistry(t),
		Model:     "gpt-5",
		ChannelID: 42,
		UserInput: "在么",
	}, collectEvents(&events, 0, nil))

	require.NoError(t, err)
	// 模型与渠道钉选必须原样透传给 Completer：ChannelID 丢了，管理员在设置页
	// 选的那条副驾专用渠道就会被自动路由悄悄换掉。
	assert.Equal(t, "gpt-5", completer.model)
	assert.Equal(t, 42, completer.channelID)
	// 工具按注册顺序传给模型：顺序不稳会让同一个问题在不同进程里走出不同的
	// 工具序列，eval 就没法断言了。
	require.Len(t, completer.tools, 3)
	assert.Equal(t, []string{"get_price", "get_cost", "no_handler"},
		[]string{completer.tools[0].Name, completer.tools[1].Name, completer.tools[2].Name})
}

func TestRunRejectsMissingCompleter(t *testing.T) {
	var events []Event
	_, err := Run(context.Background(), RunOptions{UserInput: "在么"}, collectEvents(&events, 0, nil))

	require.Error(t, err)
	assert.Empty(t, events)
}

// 工具 panic 不能逃出循环。
//
// 这不是假设出来的边界：九个工具都是既有查询逻辑的薄包装，那些逻辑里有大量在正常
// 请求里不可能为 nil、在副驾这条新路径上却可能为 nil 的前提（库未初始化、缓存未
// 预热）。panic 逃出去不是「这轮对话失败」，是整个网关进程挂掉——管理员问一句毛利，
// 全站 API 停服。写 eval 时真撞上过一次（无库环境下 GetCostDailyTrend 对 nil DB
// 调 Model()）。
func TestRunRecoversFromPanickingTool(t *testing.T) {
	registry := NewRegistry()
	registry.Register(Tool{
		Name:        "boom",
		Description: "必定 panic",
		Handler: func(_ context.Context, _ json.RawMessage) (any, error) {
			var m map[string]int
			m["nil map write"] = 1 // panic: assignment to entry in nil map
			return nil, nil
		},
	})

	completer := &scriptedCompleter{script: []CompletionResponse{
		{ToolCalls: []ToolCall{{ID: "call_boom", Name: "boom", Arguments: json.RawMessage(`{}`)}}},
		{Content: "那个查询失败了，我换个说法解释一下。"},
	}}

	var events []Event
	messages, err := Run(context.Background(), RunOptions{
		Completer: completer,
		Registry:  registry,
		Model:     "m",
		UserInput: "查一下",
	}, collectEvents(&events, 0, nil))

	// 整轮正常收口，不是 error。
	require.NoError(t, err)

	// 工具错误照常喂回模型，模型拿到了第二轮的机会。
	var toolContent string
	for _, msg := range messages {
		if msg.Role == RoleTool {
			toolContent = msg.Content
		}
	}
	assert.Contains(t, toolContent, "error")
	assert.Equal(t, 2, completer.calls, "模型应当拿到解释失败的那一轮")

	// tool_end 报失败，且不把 panic 原文（含指针地址与内部路径）漏进对话。
	var sawFailedEnd bool
	for _, e := range events {
		if e.Type == EventToolEnd {
			sawFailedEnd = true
			assert.False(t, e.OK)
			assert.NotContains(t, e.ErrorText, "nil map")
		}
	}
	assert.True(t, sawFailedEnd)
}
