package copilot

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 二十道管理员真会问的问题，钉的是「该调哪个工具、带哪些参数」，不是自然语言措辞。
//
// 为什么不断言回答文本：同一个毛利数，模型今天说「约 42%」明天说「42.3%」都对，
// 断言措辞只会让这套用例变成每次改 prompt 都要重写的负担。真正会静默劣化的是工具
// 选择——问毛利却去查官方价，答案听起来依然通顺，数字却是错的。
//
// 用脚本化的 Completer 跑，所以这套用例不烧 token、能进 CI。它能抓住契约漂移
// （工具改名、必填参数变更、注册表漏注册），抓不住「模型选错工具」——后者要换模型时
// 拿真 Completer 跑同一张表人工看一遍，见文件末尾的说明。
type evalCase struct {
	// question 是管理员的原话。
	question string
	// wantTool 是这一问该落到的工具。
	wantTool string
	// wantArgKeys 是参数里必须出现的键。不断言键值：相对日期（"上个月"）的具体
	// 时间戳取决于今天是几号，钉死会在跨月那天失败。
	wantArgKeys []string
}

var evalCases = []evalCase{
	// 毛利与成本：副驾存在的头号理由。
	{"上个月毛利多少", "query_cost_overview", []string{"start", "end"}},
	{"这个月到现在赚了多少", "query_cost_overview", []string{"start", "end"}},
	{"哪条渠道在亏钱", "query_margin", []string{"group_by"}},
	{"按模型看毛利，最近七天", "query_margin", []string{"group_by"}},
	{"哪个模型最不赚钱", "query_margin", []string{"group_by"}},
	{"渠道 12 上的 gpt-5.5 毛利怎么样", "query_margin", []string{"group_by"}},
	{"最近三十天整体成本是多少", "query_cost_overview", []string{"start", "end"}},

	// 定价：客户价、官方价、进价三件事必须落到三个不同的工具上。
	{"gpt-5.5 我们卖多少钱", "get_model_pricing", []string{"model"}},
	{"gpt-5.5 官方价是多少", "get_official_price", []string{"model"}},
	{"我们卖的比官方价低多少", "get_official_price", []string{"model"}},
	{"渠道 7 的进价是多少", "get_channel_cost", []string{"channel_id"}},
	{"claude-opus-4.5 各渠道分别卖多少", "get_model_pricing", []string{"model"}},
	{"deepseek-v3 的平台倍率是多少", "get_model_pricing", []string{"model"}},

	// 目录检索。
	{"我们有哪些 claude 模型", "search_models", []string{"keyword"}},
	{"deepseek 有哪些渠道", "list_channels", []string{"model"}},
	{"一共接了多少条渠道", "list_channels", nil},
	{"有没有 gemini 的模型", "search_models", []string{"keyword"}},

	// 模拟：最危险的三道。模型若自己算钱，错的就是真金白银。
	{"渠道 7 的 gpt-5.5 加价 30% 卖多少", "simulate_sell_price", []string{"channel_id", "model", "markup"}},
	{"如果渠道 7 的 gpt-5.5 改成加价 20%，毛利会怎么变", "simulate_margin_impact", []string{"channel_id", "model", "markup"}},
	{"渠道 12 的 claude-opus-4.5 按现在的加价卖多少", "simulate_sell_price", []string{"channel_id", "model"}},
}

// 用例表里的工具名必须真的存在于注册表。
//
// 没有这一条，上面那张表就是一堆自说自话的字符串：把工具改名后，用例照旧「通过」，
// 而副驾在线上已经调不到任何工具了。
func TestEval_ToolNamesExist(t *testing.T) {
	registry := BuildRegistry()
	for _, c := range evalCases {
		_, ok := registry.Get(c.wantTool)
		assert.True(t, ok, "用例 %q 期望的工具 %q 不在注册表里", c.question, c.wantTool)
	}
}

// 期望的参数键必须在工具自己的 JSON Schema 里声明过。
//
// 同理：参数改名（比如 channel_id → channel）后，用例里的旧键不会报错，只会在真
// 对话里让模型传一个工具根本不认的参数。
func TestEval_ArgKeysDeclaredInSchema(t *testing.T) {
	registry := BuildRegistry()
	for _, c := range evalCases {
		if len(c.wantArgKeys) == 0 {
			continue
		}
		tool, ok := registry.Get(c.wantTool)
		require.True(t, ok, "工具 %q 不存在", c.wantTool)

		props, _ := tool.Parameters["properties"].(map[string]any)
		require.NotNil(t, props, "工具 %q 的 Parameters 缺 properties", tool.Name)

		for _, key := range c.wantArgKeys {
			_, declared := props[key]
			assert.True(t, declared, "用例 %q：工具 %q 的 schema 没声明参数 %q", c.question, tool.Name, key)
		}
	}
}

// 整条链路跑一遍：脚本化的模型按用例要求调一次工具，循环把结果喂回去，模型收口。
//
// 脚本给三条响应而不是两条：真工具在测试环境里没库，必然报错，而循环的设计就是把
// 工具错误喂回模型让它补救——模型会再问一轮。只给两条的话失败的是脚本耗尽，测的
// 就成了「工具恰好成功」而不是工具选择。
func TestEval_ToolSelection(t *testing.T) {
	registry := BuildRegistry()

	for _, c := range evalCases {
		t.Run(c.question, func(t *testing.T) {
			args := map[string]any{}
			for _, key := range c.wantArgKeys {
				args[key] = evalArgValue(key)
			}
			encoded, err := json.Marshal(args)
			require.NoError(t, err)

			completer := &scriptedCompleter{script: []CompletionResponse{
				{ToolCalls: []ToolCall{{ID: "call_1", Name: c.wantTool, Arguments: encoded}}},
				{Content: "查到了，这是结论。"},
				{Content: "查询没拿到数据，这是我能说的部分。"},
			}}

			var events []Event
			messages, err := Run(context.Background(), RunOptions{
				Completer: completer,
				Registry:  registry,
				Model:     "eval-model",
				UserInput: c.question,
			}, collectEvents(&events, 0, nil))
			require.NoError(t, err)

			// 工具调用真的发生了，名字和参数都对。
			var toolCalled bool
			for _, msg := range messages {
				for _, call := range msg.ToolCalls {
					toolCalled = true
					assert.Equal(t, c.wantTool, call.Name)
					for _, key := range c.wantArgKeys {
						assert.Contains(t, string(call.Arguments), `"`+key+`"`)
					}
				}
			}
			assert.True(t, toolCalled, "这一问没产生任何工具调用")

			// 工具结果回到了模型手里——没有这一条，工具查了也白查。
			var sawToolResult bool
			for _, msg := range messages {
				if msg.Role == RoleTool && msg.ToolCallID == "call_1" {
					sawToolResult = true
				}
			}
			assert.True(t, sawToolResult, "工具结果没喂回模型")

			// 事件流里 start/end 成对，管理员才看得见副驾查了什么。
			var starts, ends int
			for _, e := range events {
				switch e.Type {
				case EventToolStart:
					starts++
					assert.Equal(t, c.wantTool, e.ToolName)
				case EventToolEnd:
					ends++
					assert.Equal(t, c.wantTool, e.ToolName, "tool_end 也要带工具名，start 帧丢了界面才不会显示 call_id")
				}
			}
			assert.Equal(t, starts, ends, "tool_start 与 tool_end 必须成对")
		})
	}
}

// evalArgValue 给参数键配一个类型对得上的值。类型不对工具会在解参数时就报错，
// 那样测的是解析而不是选择。
func evalArgValue(key string) any {
	switch key {
	case "channel_id":
		return 7
	case "markup":
		return 0.3
	case "days":
		return 7
	case "limit":
		return 20
	case "start":
		return 1756656000
	case "end":
		return 1759334400
	case "group_by":
		return "channel"
	case "keyword":
		return "claude"
	default:
		// model / 其余字符串参数。
		return "gpt-5.5"
	}
}

// 九个工具每个都得被至少一道用例覆盖。
//
// 漏掉一个工具意味着两件事之一：它没人用（该删），或者这张表缺了一类真实问题
// （该补）。两种都是该知道的事。
func TestEval_CoversEveryTool(t *testing.T) {
	covered := map[string]bool{}
	for _, c := range evalCases {
		covered[c.wantTool] = true
	}

	for _, tool := range BuildRegistry().List() {
		assert.True(t, covered[tool.Name], "工具 %q 没有任何 eval 用例覆盖", tool.Name)
	}
}

// 一期全部只读。这条是防线而不是文档：二期加写工具时，忘记把它排除在一期用例之外
// 会让这条直接失败，而不是让一个能改库的工具悄悄混进只读注册表。
func TestEval_AllToolsReadOnly(t *testing.T) {
	for _, tool := range BuildRegistry().List() {
		assert.False(t, tool.Mutates, "一期工具 %q 不该会改库", tool.Name)
	}
}

// 这套用例测不到的事，留给换模型时的人工验收：
//
// 脚本化的 Completer 是「假装模型选对了工具」，所以它证明不了真模型会选对。换副驾
// 模型时（设置页改 copilot_setting.model），拿真 Completer 把上面二十道问题跑一遍
// 人工看工具选择，尤其是最后三道模拟题——模型若绕过 simulate_* 自己算钱，回答会
// 通顺得看不出问题，而数字是错的。
