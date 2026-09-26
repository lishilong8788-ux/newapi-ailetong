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

// writeRegistry 在只读工具之外加一个标了 Mutates 的写工具。
func writeRegistry(t *testing.T, calls *int) *Registry {
	t.Helper()
	r := newTestRegistry(t)
	r.Register(Tool{
		Name:        "set_markup",
		Description: "改渠道利润率",
		Mutates:     true,
		Handler: func(_ context.Context, _ json.RawMessage) (any, error) {
			*calls++
			return map[string]any{"ok": true}, nil
		},
	})
	return r
}

// 闸门命中时这一轮一条消息都不能返回。
//
// 这是回归测试，不是覆盖率：原来返回的是已产出的 added，其末条是那条带 tool_calls 的
// 助手消息，而配对的 tool 结果永远不会产生——工具就是在闸门这里被拦下的。调用方把它
// 落库之后，每一轮都会把这条悬空消息带回 prompt，而 OpenAI 兼容上游对 tool_call 与
// tool 结果的配对是硬校验，缺一个就是 400。于是那个会话彻底废掉：不只是这次批准失败，
// 之后问任何无关的问题也一样 400。
func TestRunGateReturnsNoMessagesSoNothingIsPersisted(t *testing.T) {
	handlerCalls := 0
	completer := &scriptedCompleter{script: []CompletionResponse{
		{
			Content: "我把渠道 7 的利润率调成 0.3。",
			ToolCalls: []ToolCall{{
				ID:        "call-write",
				Name:      "set_markup",
				Arguments: json.RawMessage(`{"channel_id":7,"markup":0.3}`),
			}},
			PromptTokens:     40,
			CompletionTokens: 9,
		},
	}}

	var events []Event
	messages, err := Run(context.Background(), RunOptions{
		Completer: completer,
		Registry:  writeRegistry(t, &handlerCalls),
		Model:     "gpt-5",
	}, collectEvents(&events, 0, nil))

	require.NoError(t, err)
	assert.Empty(t, messages, "闸门拦下的这一轮不能有任何消息进落库路径")
	assert.Zero(t, handlerCalls, "没批准就不能真的写")
}

// 闸门发出的事件里必须带参数原值，而且 usage 要在 confirm_required 之前发出去。
func TestRunGateEmitsArgsAndUsageBeforeStopping(t *testing.T) {
	handlerCalls := 0
	completer := &scriptedCompleter{script: []CompletionResponse{
		{
			Content: "准备把渠道 7 调成平进平出。",
			ToolCalls: []ToolCall{{
				ID:        "call-write",
				Name:      "set_markup",
				Arguments: json.RawMessage(`{"channel_id":7,"markup":0}`),
			}},
			PromptTokens:     40,
			CompletionTokens: 9,
		},
	}}

	var events []Event
	_, err := Run(context.Background(), RunOptions{
		Completer: completer,
		Registry:  writeRegistry(t, &handlerCalls),
		Model:     "gpt-5",
	}, collectEvents(&events, 0, nil))
	require.NoError(t, err)

	// 没有 tool_start：工具没跑，画一行步骤就等于说它跑了。
	// 也没有 done：这一轮不是完成，是停下来等人。
	assert.Equal(t, []string{EventText, EventUsage, EventConfirmRequired}, eventTypes(events))

	confirm := events[2]
	assert.Equal(t, "set_markup", confirm.ToolName)
	assert.Equal(t, "call-write", confirm.ToolCallID)
	// markup: 0 必须原样在事件里。管理员要看的是真的要写进库的值，而 0 是合法配置
	// （平进平出），被当成"没传"而丢掉就会让他对一个看不见数值的改动点同意。
	assert.JSONEq(t, `{"channel_id":7,"markup":0}`, string(confirm.ToolArgs))

	// 这一轮的 token 是真花了的，中止不等于免费。
	assert.Equal(t, 40, events[1].PromptTokens)
	assert.Equal(t, 9, events[1].CompletionTokens)
}

// 带着批准重放，写工具就真的执行，并且这一轮正常收口落库。
func TestRunApprovedToolExecutesAndPersists(t *testing.T) {
	handlerCalls := 0
	completer := &scriptedCompleter{script: []CompletionResponse{
		{
			ToolCalls: []ToolCall{{
				ID:        "call-write",
				Name:      "set_markup",
				Arguments: json.RawMessage(`{"channel_id":7,"markup":0.3}`),
			}},
		},
		{Content: "已经改好了，渠道 7 现在是 0.3。"},
	}}

	var events []Event
	messages, err := Run(context.Background(), RunOptions{
		Completer:    completer,
		Registry:     writeRegistry(t, &handlerCalls),
		Model:        "gpt-5",
		ApprovedTool: "set_markup",
	}, collectEvents(&events, 0, nil))

	require.NoError(t, err)
	assert.Equal(t, 1, handlerCalls)
	assert.Contains(t, eventTypes(events), EventToolEnd)
	assert.Contains(t, eventTypes(events), EventDone)
	assert.NotContains(t, eventTypes(events), EventConfirmRequired)

	// 助手的两条消息加一条工具结果：配对完整，落库之后历史仍然合法。
	var toolResults int
	for _, msg := range messages {
		if msg.Role == RoleTool {
			toolResults++
			assert.Equal(t, "call-write", msg.ToolCallID)
		}
	}
	assert.Equal(t, 1, toolResults, "被批准的调用必须留下配对的 tool 结果")
}

// 批准是按工具名的，不是一张通行证：同一轮里另一个写工具照样被拦。
//
// 用 bool 表达批准就会在这里失守——管理员在弹窗里看到并点头的只是其中一个。
func TestRunApprovalDoesNotCoverADifferentWriteTool(t *testing.T) {
	handlerCalls := 0
	registry := writeRegistry(t, &handlerCalls)
	otherCalls := 0
	registry.Register(Tool{
		Name:    "delete_channel",
		Mutates: true,
		Handler: func(_ context.Context, _ json.RawMessage) (any, error) {
			otherCalls++
			return nil, nil
		},
	})

	completer := &scriptedCompleter{script: []CompletionResponse{
		{
			ToolCalls: []ToolCall{
				{ID: "call-a", Name: "set_markup", Arguments: json.RawMessage(`{"channel_id":7,"markup":0.3}`)},
				{ID: "call-b", Name: "delete_channel", Arguments: json.RawMessage(`{"channel_id":7}`)},
			},
		},
	}}

	var events []Event
	messages, err := Run(context.Background(), RunOptions{
		Completer:    completer,
		Registry:     registry,
		Model:        "gpt-5",
		ApprovedTool: "set_markup",
	}, collectEvents(&events, 0, nil))

	require.NoError(t, err)
	assert.Equal(t, 1, handlerCalls, "被点头的那个照常执行")
	assert.Zero(t, otherCalls, "没被点头的那个必须停下来")
	assert.Empty(t, messages, "这一轮又停在闸门上，同样不能落库")

	confirmed := make([]string, 0, 1)
	for _, e := range events {
		if e.Type == EventConfirmRequired {
			confirmed = append(confirmed, e.ToolName)
		}
	}
	assert.Equal(t, []string{"delete_channel"}, confirmed)
}

// 批准连参数一起对。工具名对上但参数变了，仍然要停下来重新问。
//
// 这是回归测试：重放会重新问一次模型，而模型不确定。只对名字的话，管理员看着
// markup=0.3 点的头，模型第二次给出 markup=3.0 也会被放行 —— handler 只兜边界，
// 一个合法但他从没同意过的值会照写进库，而弹窗上写着"屏幕上的就是工具会收到的"。
func TestRunApprovalRejectsChangedArguments(t *testing.T) {
	handlerCalls := 0
	completer := &scriptedCompleter{script: []CompletionResponse{
		{
			ToolCalls: []ToolCall{{
				ID:   "call-write",
				Name: "set_markup",
				// 管理员点头时看到的是 0.3，模型这次给的是 3.0。
				Arguments: json.RawMessage(`{"channel_id":7,"markup":3.0}`),
			}},
		},
	}}

	var events []Event
	messages, err := Run(context.Background(), RunOptions{
		Completer:    completer,
		Registry:     writeRegistry(t, &handlerCalls),
		Model:        "gpt-5",
		ApprovedTool: "set_markup",
		ApprovedArgs: json.RawMessage(`{"channel_id":7,"markup":0.3}`),
	}, collectEvents(&events, 0, nil))

	require.NoError(t, err)
	assert.Zero(t, handlerCalls, "参数不是他同意过的那份，不能执行")
	assert.Empty(t, messages)
	assert.Contains(t, eventTypes(events), EventConfirmRequired)
	// 新的提议要摆到他面前，而不是悄悄放行或悄悄丢掉。
	assert.JSONEq(t, `{"channel_id":7,"markup":3.0}`, string(events[len(events)-1].ToolArgs))
}

// 语义相同但键顺序/空白不同，必须算同一份参数。
//
// 按字节比就会在这里失守：两次模型响应的键顺序本来就不保证一致，管理员会陷在
// 「点了确认又弹出来」的循环里，永远点不动。
func TestRunApprovalIgnoresKeyOrderAndWhitespace(t *testing.T) {
	handlerCalls := 0
	completer := &scriptedCompleter{script: []CompletionResponse{
		{
			ToolCalls: []ToolCall{{
				ID:        "call-write",
				Name:      "set_markup",
				Arguments: json.RawMessage(`{"markup":0.3,"channel_id":7}`),
			}},
		},
		{Content: "改好了。"},
	}}

	var events []Event
	_, err := Run(context.Background(), RunOptions{
		Completer:    completer,
		Registry:     writeRegistry(t, &handlerCalls),
		Model:        "gpt-5",
		ApprovedTool: "set_markup",
		ApprovedArgs: json.RawMessage("{\n  \"channel_id\": 7,\n  \"markup\": 0.3\n}"),
	}, collectEvents(&events, 0, nil))

	require.NoError(t, err)
	assert.Equal(t, 1, handlerCalls, "同一份参数换个写法仍然是同一份")
	assert.NotContains(t, eventTypes(events), EventConfirmRequired)
}
