package copilot

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// Run 跑完一轮副驾对话。签名对应 types.go 里的 RunFunc。
//
// 返回模型这一轮产出的消息，供调用方落库：助手文本、带工具调用的助手消息、工具
// 结果。system prompt、History 和用户输入都不在里面，理由见函数内注释。
//
// 出错时也返回已经产出的部分：失败那一轮里模型说过的话和调过的工具是管理员唯一
// 的排查线索，丢了就只剩一句「出错了」。
func Run(ctx context.Context, opts RunOptions, emit Emit) ([]Message, error) {
	if opts.Completer == nil {
		return nil, fmt.Errorf("copilot: completer is nil")
	}

	maxRounds := opts.MaxRounds
	if maxRounds <= 0 {
		maxRounds = DefaultMaxRounds
	}

	// conversation 是喂给模型的全量上下文。
	conversation := make([]Message, 0, len(opts.History)+2)
	conversation = append(conversation, Message{Role: RoleSystem, Content: SystemPrompt()})
	conversation = append(conversation, opts.History...)
	conversation = append(conversation, Message{Role: RoleUser, Content: opts.UserInput, Images: opts.UserImages})

	// added 只收模型这一轮产出的消息：助手文本、工具调用、工具结果。不含
	// system prompt（每轮重新加，落库等于重复存同一段文字）、不含 History（调用
	// 方手里已经有了），也不含用户输入 —— 调用方在开流之前就已经把它落了库，
	// 这里再返一份会让同一句话在会话里出现两次。
	var added []Message

	var tools []Tool
	if opts.Registry != nil {
		tools = opts.Registry.List()
	}

	promptTokens := 0
	completionTokens := 0

	for round := 0; round < maxRounds; round++ {
		resp, err := opts.Completer.Complete(ctx, CompletionRequest{
			Model:     opts.Model,
			Messages:  conversation,
			Tools:     tools,
			ChannelID: opts.ChannelID,
		})
		if err != nil {
			// Completer 出错是唯一会终止整轮的错误：连不上模型就没有下一步可走，
			// 而工具出错还能喂回去让模型换个问法。
			return added, err
		}
		if resp == nil {
			return added, fmt.Errorf("copilot: completer returned nil response")
		}
		promptTokens += resp.PromptTokens
		completionTokens += resp.CompletionTokens

		// 有文本就发，不管后面还有没有工具调用：模型在调工具之间会解释自己要
		// 干什么（"先查一下这个模型的官方价…"），那句话是管理员判断它有没有在
		// 编数的线索，吞掉就只剩一串工具名。
		if resp.Content != "" {
			if emitErr := emit(Event{Type: EventText, Text: resp.Content}); emitErr != nil {
				return added, emitErr
			}
		}

		assistant := Message{Role: RoleAssistant, Content: resp.Content, ToolCalls: resp.ToolCalls}
		conversation = append(conversation, assistant)
		added = append(added, assistant)

		if len(resp.ToolCalls) == 0 {
			if emitErr := emit(Event{
				Type:             EventUsage,
				PromptTokens:     promptTokens,
				CompletionTokens: completionTokens,
			}); emitErr != nil {
				return added, emitErr
			}
			if emitErr := emit(Event{Type: EventDone}); emitErr != nil {
				return added, emitErr
			}
			return added, nil
		}

		for _, call := range resp.ToolCalls {
			if emitErr := emit(Event{
				Type:       EventToolStart,
				ToolName:   call.Name,
				ToolArgs:   call.Arguments,
				ToolCallID: call.ID,
			}); emitErr != nil {
				return added, emitErr
			}

			started := time.Now()
			var (
				result  any
				callErr error
				tool    Tool
				found   bool
			)
			if opts.Registry != nil {
				tool, found = opts.Registry.Get(call.Name)
			}
			switch {
			case !found:
				// 模型编了一个不存在的工具名。不是致命错误：把可用工具名列回去，
				// 它下一轮通常能自己纠正。
				callErr = fmt.Errorf("unknown tool %q", call.Name)
			case tool.Handler == nil:
				callErr = fmt.Errorf("tool %q has no handler", call.Name)
			case tool.Mutates && opts.ApprovedTool != call.Name:
				// 没批准的写操作到此为止。判的是 Tool.Mutates 而不是工具名前缀：
				// 前缀约定一旦有人加个 update_xxx 就静默失守。
				//
				// 参数原值一起发出去，管理员看到的必须是真的要写进库的东西，而不是
				// 模型对自己意图的转述。
				if emitErr := emit(Event{
					Type:       EventConfirmRequired,
					ToolName:   call.Name,
					ToolArgs:   call.Arguments,
					ToolCallID: call.ID,
				}); emitErr != nil {
					return added, emitErr
				}
				return added, nil
			default:
				result, callErr = runToolHandler(ctx, tool, call.Arguments)
			}

			endEvent := Event{
				Type:       EventToolEnd,
				ToolName:   call.Name,
				ToolCallID: call.ID,
				DurationMs: time.Since(started).Milliseconds(),
				OK:         callErr == nil,
			}
			if callErr != nil {
				endEvent.ErrorText = callErr.Error()
			}
			if emitErr := emit(endEvent); emitErr != nil {
				return added, emitErr
			}

			// 工具结果统一走 common.Marshal 落成字符串，包括出错的情况：模型这一
			// 侧只认 tool 消息的内容，把错误写成 {"error":"..."} 它才有机会解释或
			// 改用别的工具。直接中断整轮的话，管理员看到的是一个没有下文的报错。
			payload := result
			if callErr != nil {
				payload = map[string]string{"error": callErr.Error()}
			}
			encoded, marshalErr := common.Marshal(payload)
			if marshalErr != nil {
				encoded, _ = common.Marshal(map[string]string{
					"error": fmt.Sprintf("tool %q result is not serializable: %v", call.Name, marshalErr),
				})
			}

			toolMessage := Message{Role: RoleTool, Content: string(encoded), ToolCallID: call.ID}
			conversation = append(conversation, toolMessage)
			added = append(added, toolMessage)
		}
	}

	// 撞上轮数上限是正常结局，不是 error：模型查了 MaxRounds 轮还没收口，管理员
	// 需要看到已经查出来的东西加一句说明，而不是一个红色报错。
	limitText := fmt.Sprintf("已达到本轮工具调用上限（%d 轮），先停在这里。上面的工具结果是已经查到的部分，需要继续的话请把问题拆小一点再问我。", maxRounds)
	if emitErr := emit(Event{Type: EventText, Text: limitText}); emitErr != nil {
		return added, emitErr
	}
	added = append(added, Message{Role: RoleAssistant, Content: limitText})

	if emitErr := emit(Event{
		Type:             EventUsage,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
	}); emitErr != nil {
		return added, emitErr
	}
	if emitErr := emit(Event{Type: EventDone}); emitErr != nil {
		return added, emitErr
	}
	return added, nil
}

// runToolHandler 执行一个工具，并把 panic 收成 error。
//
// 为什么必须有这道防线：工具是既有查询逻辑的薄包装，而那些逻辑有大量在正常请求里
// 不可能为 nil、但在副驾这条新调用路径上可能为 nil 的前提——库没初始化、缓存还没
// 预热、某个 map 是空的。任何一个 nil 解引用都会 panic，而 panic 从这里逃出去不是
// 「这轮对话失败」，是整个网关进程挂掉：管理员问一句毛利，全站 API 停服。
//
// 只读助手绝不该有这种能力。panic 在这里退化成一条喂回模型的错误，与 handler 主动
// 返回 error 走同一条路。
func runToolHandler(ctx context.Context, tool Tool, args []byte) (result any, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			// 不把 panic 原文喂回模型：里面常带指针地址和内部路径，对模型无用，
			// 而且会进对话历史。管理员那侧靠 SysError 的完整堆栈排查。
			common.SysError(fmt.Sprintf("copilot tool %q panicked: %v", tool.Name, recovered))
			result = nil
			err = fmt.Errorf("tool %q failed internally", tool.Name)
		}
	}()
	return tool.Handler(ctx, args)
}
