package copilot

import (
	"context"
	"encoding/json"
)

// 运营副驾（Copilot）的共享契约。
//
// 命名避开 agent：这个代码库里 agent 已经是「代理分销」（AgentProfile、
// AgentCommission、/api/agent），再用一次会让路由、日志、代码检索全部二义。
//
// 一期只读：所有工具都不写库。写操作（propose/apply change_set）是二期，
// 届时 Tool.Mutates 从恒 false 变成真实分级。

// ToolHandler 执行一次工具调用。args 是模型给的原始 JSON 参数；返回值会被
// common.Marshal 后塞回对话，所以必须是可序列化的纯数据。
type ToolHandler func(ctx context.Context, args json.RawMessage) (any, error)

// Tool 是模型能调的一个函数。
type Tool struct {
	Name        string
	Description string
	// Parameters 是 JSON Schema，对应 OpenAI function calling 的 parameters。
	Parameters map[string]any
	// Mutates 标记这个工具会不会改库。一期恒为 false；二期的 propose/apply 才
	// 置 true —— 循环据此决定是否需要人工确认，而不是靠工具名前缀约定，那种
	// 约定一旦有人加个 update_xxx 就会静默失守。
	Mutates bool
	Handler ToolHandler
}

// Registry 持有一轮对话可用的工具集。不是全局单例：eval 测试要能装一套假工具
// 跑循环，全局注册表会让并发测试互相污染。
type Registry struct {
	order []string
	tools map[string]Tool
}

func NewRegistry() *Registry {
	return &Registry{tools: map[string]Tool{}}
}

// Register 追加一个工具。同名覆盖，但不改变原有顺序，这样工具在 prompt 里的
// 出场顺序是稳定的 —— 顺序不稳会让同一个问题在不同进程里走出不同的工具序列，
// eval 就没法断言了。
func (r *Registry) Register(t Tool) {
	if _, exists := r.tools[t.Name]; !exists {
		r.order = append(r.order, t.Name)
	}
	r.tools[t.Name] = t
}

func (r *Registry) Get(name string) (Tool, bool) {
	t, ok := r.tools[name]
	return t, ok
}

// List 按注册顺序返回全部工具。
func (r *Registry) List() []Tool {
	out := make([]Tool, 0, len(r.order))
	for _, name := range r.order {
		out = append(out, r.tools[name])
	}
	return out
}

// Role 是对话消息的角色。用自有常量而不是直接借 relaykit/dto 的字符串：副驾的
// 对话要落库，落库的枚举值不该随上游 DTO 重构而漂移。
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
)

// ToolCall 是模型发起的一次调用。ID 由模型给出，回传 tool 结果时必须原样带回。
type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// Message 是一条对话消息，也是落库的行结构。
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	// Images 是图片的【相对路径】，不是图片内容。service 层不持有这些字节：
	// 读盘转 data URL 发生在 controller 的 Completer 实现里，因为只有那一层
	// 知道上游要什么格式，而这里只需要知道"这条消息带了几张图"。
	Images []string `json:"images,omitempty"`
	// ToolCalls 只在 Role == RoleAssistant 且模型要求调工具时非空。
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
	// ToolCallID 只在 Role == RoleTool 时非空，指回被回答的那次调用。
	ToolCallID string `json:"tool_call_id,omitempty"`
}

// CompletionRequest 是副驾对 LLM 的一次请求。
type CompletionRequest struct {
	Model    string
	Messages []Message
	Tools    []Tool
	// ChannelID 非 0 时把请求钉在这条渠道上（管理员在设置页选的）。0 表示走
	// 正常路由。
	ChannelID int
}

// CompletionResponse 是 LLM 的一次回答。
type CompletionResponse struct {
	Content   string
	ToolCalls []ToolCall
	// PromptTokens/CompletionTokens 用于在界面上显示副驾自己烧了多少 token。
	PromptTokens     int
	CompletionTokens int
}

// Completer 把「怎么调到 LLM」这件事挡在循环之外。
//
// 一期的实现在 controller 层（复刻 channel-test.go 的合成 gin.Context 走自家
// relay），而 service 不能 import controller —— 会成环。所以这里定接口，由
// controller 在启动时注入。同时 eval 测试可以塞一个脚本化的假 Completer，
// 断言工具调用序列而不真的烧 token。
type Completer interface {
	Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error)
}

// SSE 事件类型。前端按这些字符串分发，值一旦发布就不能改。
//
// 一期 LLM 调用不流式（拿全量响应才好解析 tool_calls），所以 EventText 是
// 整段文本而不是 token 增量。但一轮对话可能产生多个 EventText：模型在调工具
// 之间会说话（"先查一下这个模型的官方价…"），每一轮助手消息都发一条。
const (
	// EventText 一段助手文本。
	EventText = "text"
	// EventToolStart 开始调工具，带工具名和参数 —— 管理员必须看得见副驾在查
	// 什么，这是判断它有没有在编数的唯一办法。
	EventToolStart = "tool_start"
	// EventToolEnd 工具返回，带耗时和成功与否。不带完整返回值：一次毛利查询
	// 可能是几十 KB，塞进 SSE 只会把界面卡住。
	EventToolEnd = "tool_end"
	// EventUsage 本轮 token 消耗。
	EventUsage = "usage"
	// EventDone 整轮结束。
	EventDone = "done"
	// EventError 出错终止。
	EventError = "error"
)

// Event 是一条 SSE 事件。
type Event struct {
	Type string `json:"type"`
	// Text 用于 EventText / EventError。
	Text string `json:"text,omitempty"`
	// ToolName / ToolArgs 用于 EventToolStart。
	ToolName string          `json:"tool_name,omitempty"`
	ToolArgs json.RawMessage `json:"tool_args,omitempty"`
	// ToolCallID 串起同一次调用的 start 与 end。
	ToolCallID string `json:"tool_call_id,omitempty"`
	// DurationMs / OK / ErrorText 用于 EventToolEnd。
	DurationMs int64  `json:"duration_ms,omitempty"`
	OK         bool   `json:"ok,omitempty"`
	ErrorText  string `json:"error_text,omitempty"`
	// PromptTokens / CompletionTokens 用于 EventUsage。
	PromptTokens     int `json:"prompt_tokens,omitempty"`
	CompletionTokens int `json:"completion_tokens,omitempty"`
}

// Emit 是循环向外推送事件的回调。返回 error 表示客户端已断开，循环应当停止。
type Emit func(Event) error

// RunOptions 是跑一轮副驾对话需要的全部输入。
type RunOptions struct {
	Completer Completer
	Registry  *Registry
	Model     string
	ChannelID int
	// MaxRounds 是工具调用的轮数上限，防止模型陷在「查了又查」里烧 token。
	// 0 表示用 DefaultMaxRounds。
	MaxRounds int
	// History 是本会话此前的消息（不含 system prompt，循环自己加）。
	History []Message
	// UserInput 是管理员这次说的话。
	UserInput string
	// UserImages 是这次贴的图片相对路径。可以在 UserInput 为空时非空：只贴一张
	// 报表截图不说话是个合法的提问。
	UserImages []string
}

// DefaultMaxRounds 是工具轮数的兜底上限。9 个只读工具里，最长的合理链路是
// 「搜模型 → 查定价 → 列渠道 → 查进价 → 模拟卖价」，5 步；留到 8 是给模型
// 走错一两步再纠回来的余量。
const DefaultMaxRounds = 8

// Run 跑完一轮对话：反复问模型、执行它要的工具、把结果喂回去，直到模型给出
// 不带工具调用的回答，或者撞上轮数上限。
//
// 返回本轮新增的消息（助手文本、工具调用、工具结果），供调用方落库。
// 实现在 loop.go。
type RunFunc func(ctx context.Context, opts RunOptions, emit Emit) ([]Message, error)
