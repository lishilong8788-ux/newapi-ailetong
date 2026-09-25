package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/copilot"

	"github.com/tidwall/gjson"

	"github.com/gin-gonic/gin"
)

// copilotTrafficSource 标记副驾自己烧掉的 token。副驾是内部工具，它的花销不是
// 客户流量，报表按这个值把它和真实业务流量分开。
const copilotTrafficSource = model.TrafficSourceCopilot

// copilotErrorBodyPreviewRunes 是上游错误体/无法解析响应体回传给管理员时的截断
// 长度。够看出是鉴权失败、模型不存在还是网关返回了一页 HTML，又不至于把整页塞进
// 对话。
//
// 按 rune 而不是 byte：relay 的错误消息大多是中文，按字节切会把一个汉字劈成半个，
// 留下一串乱码结尾 —— 而这段文字的唯一用途就是给管理员读。
const copilotErrorBodyPreviewRunes = 512

// copilotImageContent 把「一段文字 + N 张图」拼成上游要的多模态 content 数组。
//
// 图片以 base64 data URL 内联，不给 URL：图片存在管理员会话的私有目录里，下发
// 端点挂着 AdminAuth，上游的服务器取不到，给它一个 URL 等于给它一个 404。
//
// 读盘失败的那一张跳过，并在文本里留一句说明，而不是整轮报错：历史里丢一张图
// （被清理、磁盘换过）不该让管理员当前这次提问失败，但也不能让模型以为它看全了
// —— 它会照着看不见的图编。
func copilotImageContent(text string, relativePaths []string) []dto.MediaContent {
	parts := make([]dto.MediaContent, 0, len(relativePaths)+1)
	missing := 0
	images := make([]dto.MediaContent, 0, len(relativePaths))

	for _, relativePath := range relativePaths {
		dataURL, err := service.ReadCopilotImageDataURL(relativePath)
		if err != nil {
			common.SysError("failed to read copilot image for llm: " + err.Error())
			missing++
			continue
		}
		// 指针而不是值：GetImageMedia 只认 *MessageImageUrl 和 map[string]any，
		// 值类型会静默返回 nil。这条请求目前会被 marshal 成 JSON 再由 relay 解回
		// map，两种都能工作，但留值类型等于给将来「不再走 marshal」的改动埋一个
		// 悄悄丢图的坑。
		images = append(images, dto.MediaContent{
			Type:     dto.ContentTypeImageURL,
			ImageUrl: &dto.MessageImageUrl{Url: dataURL},
		})
	}

	if missing > 0 {
		note := fmt.Sprintf("（本条消息有 %d 张图片已无法读取，请不要对它们的内容作任何推测。）", missing)
		if strings.TrimSpace(text) == "" {
			text = note
		} else {
			text = text + "\n\n" + note
		}
	}
	// 文本在前：图片之后紧跟的那段文字，有的上游会当成图片的说明而不是提问。
	if strings.TrimSpace(text) != "" {
		parts = append(parts, dto.MediaContent{Type: dto.ContentTypeText, Text: text})
	}
	return append(parts, images...)
}

// NewRelayCompleter 返回一个走本网关自己 relay 的 Completer。
//
// 为什么不直接用 HTTP 客户端打自己：那要一把真 token、要走一遍网络、还得处理
// 自签证书和内网地址。走进程内 relay 的好处是副驾天然复用这 40 多个已配置好
// 的上游、渠道重试、模型映射和参数覆盖，而且它的 token 消耗会落进正常的日志与
// 成本账 —— 副驾自己有多贵，管理员在同一张报表里看得见。
//
// adminUserID 是副驾计费挂靠的管理员。请求以他的身份、他的分组发出，配额也从他
// 头上扣。
func NewRelayCompleter(adminUserID int) copilot.Completer {
	return &relayCompleter{adminUserID: adminUserID}
}

type relayCompleter struct {
	adminUserID int
}

func (rc *relayCompleter) Complete(ctx context.Context, req copilot.CompletionRequest) (*copilot.CompletionResponse, error) {
	if rc.adminUserID <= 0 {
		return nil, errors.New("copilot: 未配置副驾计费用户")
	}
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("copilot: 未配置副驾模型")
	}

	messages := make([]dto.Message, 0, len(req.Messages))
	for _, msg := range req.Messages {
		// Content 恒为字符串，哪怕是空串：它是 any 且 tag 上没有 omitempty，留 nil
		// 会 marshal 成 `"content":null`，而带 tool_calls 的助手消息常常没有文本 ——
		// 有的上游对 null content 直接 400。
		converted := dto.Message{Role: msg.Role, Content: msg.Content}
		if len(msg.Images) > 0 {
			converted.Content = copilotImageContent(msg.Content, msg.Images)
		}
		if msg.ToolCallID != "" {
			converted.ToolCallId = msg.ToolCallID
		}
		if len(msg.ToolCalls) > 0 {
			calls := make([]dto.ToolCallRequest, 0, len(msg.ToolCalls))
			for _, call := range msg.ToolCalls {
				calls = append(calls, dto.ToolCallRequest{
					ID:   call.ID,
					Type: "function",
					Function: dto.FunctionRequest{
						Name:      call.Name,
						Arguments: string(call.Arguments),
					},
				})
			}
			encoded, err := common.Marshal(calls)
			if err != nil {
				return nil, fmt.Errorf("copilot: 序列化历史工具调用失败: %w", err)
			}
			converted.ToolCalls = encoded
		}
		messages = append(messages, converted)
	}

	tools := make([]dto.ToolCallRequest, 0, len(req.Tools))
	for _, tool := range req.Tools {
		tools = append(tools, dto.ToolCallRequest{
			Type: "function",
			Function: dto.FunctionRequest{
				Name:        tool.Name,
				Description: tool.Description,
				Parameters:  tool.Parameters,
			},
		})
	}

	// 一期不流式：拿全量响应解析 tool_calls 远比把 delta 重新拼成完整参数可靠
	// （参数是 JSON 字符串，拼错一个括号整轮就废了）。界面上的进度条靠循环逐个
	// 工具发事件，不依赖 LLM 这一段流式。
	stream := false
	relayRequest := dto.GeneralOpenAIRequest{
		Model:    req.Model,
		Messages: messages,
		Stream:   &stream,
	}
	if len(tools) > 0 {
		relayRequest.Tools = tools
		relayRequest.ToolChoice = "auto"
	}

	body, err := common.Marshal(relayRequest)
	if err != nil {
		return nil, fmt.Errorf("copilot: 序列化请求失败: %w", err)
	}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	defer common.CleanupBodyStorage(c)

	// 合成上下文里没有 BodyStorageCleanup / RequestId 这些中间件，请求 ID 要自己
	// 给，否则日志里这一条和其他请求串不起来。
	requestID := common.NewRequestId()
	c.Set(common.RequestIdKey, requestID)
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), common.RequestIdKey, requestID))
	common.SetContextKey(c, constant.ContextKeyTrafficSource, copilotTrafficSource)

	userCache, err := model.GetUserCache(rc.adminUserID)
	if err != nil {
		return nil, fmt.Errorf("copilot: 读取用户信息失败: %w", err)
	}
	userCache.WriteContext(c)
	c.Set("id", rc.adminUserID)
	c.Set("role", userCache.Role)
	// UsingGroup 平时由 UserAuth 写入，这里没有那一环。定成用户自己的分组，与
	// 游乐场同一口径：副驾按这个管理员的分组倍率计费。
	common.SetContextKey(c, constant.ContextKeyUsingGroup, userCache.Group)

	tempToken := &model.Token{
		UserId: rc.adminUserID,
		Name:   fmt.Sprintf("copilot-%s", userCache.Group),
		Group:  userCache.Group,
		// 这个 token 只存在于内存里，数据库没有对应行，所以它没有「自己的额度」可扣。
		// 不标无限额度的话，预扣费会拿 token_id=0 去做原子 UPDATE，影响 0 行，判定为
		// 额度不足直接 403 —— 报错还会显示 `remain quota: ¥0.000000`，因为那行文案
		// 回查 token_key（也是空的）没查到，变量停在初始值，看着像欠费其实不是。
		//
		// 跳过的只是令牌层。用户层的资金来源预扣（BillingSession 第 2 步）照常执行，
		// 副驾该花的额度还是从这个管理员头上扣。
		UnlimitedQuota: true,
	}
	if err := middleware.SetupContextForToken(c, tempToken); err != nil {
		return nil, fmt.Errorf("copilot: 初始化临时令牌失败: %w", err)
	}

	if req.ChannelID != 0 {
		// 直接落 context，不走 SetupContextForToken 的 key 分段路径：那条路径是给
		// `sk-xxx-<channelId>` 这种 API key 写法用的，还要再判一次管理员身份。副驾
		// 本来就只有管理员能开，钉渠道是管理员在设置页选的，等价于游乐场的
		// X-New-Api-Channel-Id。
		//
		// 存字符串而不是 int：读这个键的地方（Distribute、毛利表头）都是 `.(string)`
		// 断言，换成 int 会在那里 panic。relay 的 shouldRetry 只看这个键在不在，
		// 在就不跨渠道重试 —— 钉了渠道就该钉住，失败要报在那条渠道上。
		common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, strconv.Itoa(req.ChannelID))
	}

	// 合成上下文没走 Distribute，渠道得自己选好再进 Relay。不选的话
	// controller.getChannel 第一轮会从空 context 里拼出一个 id=0、base_url 为空的
	// 渠道，拿它真的发一次请求，白烧一次重试才轮到真正的选路。
	channel, err := rc.selectChannel(c, req)
	if err != nil {
		return nil, fmt.Errorf("copilot: 选择副驾渠道失败: %w", err)
	}
	common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())
	if setupErr := middleware.SetupContextForSelectedChannel(c, channel, req.Model); setupErr != nil {
		return nil, fmt.Errorf("copilot: 初始化渠道 #%d 失败: %s", channel.Id, setupErr.Error())
	}

	Relay(c, types.RelayFormatOpenAI)

	respBody := recorder.Body.Bytes()
	if recorder.Code != http.StatusOK {
		return nil, fmt.Errorf("copilot: 副驾模型 %s 调用失败（HTTP %d）：%s",
			req.Model, recorder.Code, copilotUpstreamErrorText(respBody))
	}

	var parsed dto.OpenAITextResponse
	if err := common.Unmarshal(respBody, &parsed); err != nil {
		// 体积一定要截断：上游偶尔会在 200 里回一页 HTML（网关、WAF、登录跳转），
		// 整页塞进错误消息就把界面和日志一起淹了。
		return nil, fmt.Errorf("copilot: 无法解析副驾模型响应: %w；响应体片段：%s",
			err, truncateForCopilot(string(respBody)))
	}
	// 有些上游 200 也带 error 体（网关层把错误包了一层），这种响应没有 choices，
	// 当成失败比让循环拿着空回答继续问更好。
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("copilot: 副驾模型 %s 返回了空回答：%s",
			req.Model, copilotUpstreamErrorText(respBody))
	}

	choice := parsed.Choices[0]
	out := &copilot.CompletionResponse{
		Content:          choice.Message.StringContent(),
		PromptTokens:     parsed.Usage.PromptTokens,
		CompletionTokens: parsed.Usage.CompletionTokens,
	}
	for _, call := range choice.Message.ParseToolCalls() {
		if call.Function.Name == "" {
			continue
		}
		out.ToolCalls = append(out.ToolCalls, copilot.ToolCall{
			ID:        call.ID,
			Name:      call.Function.Name,
			Arguments: copilotToolArguments(call.Function.Arguments),
		})
	}
	return out, nil
}

// copilotToolArguments 保证工具参数一定是合法 JSON。
//
// 必须在这里兜住，不能指望模型：循环把参数放进 Event.ToolArgs（json.RawMessage）
// 发 SSE，非法 JSON 会让整帧 marshal 失败 —— 于是 emit 报错、循环按"客户端断开"
// 中止，一次模型手滑就毁掉整轮对话，而正确的结局是让工具自己拒掉这个参数。
//
// 非法内容包成 JSON 字符串而不是替成 {}：替成空对象会让工具拿着一套默认值当真跑
// 起来，返回一个看似正常其实答非所问的结果。包成字符串则 handler 的 decodeArgs
// 必然失败，错误照常喂回模型，它下一轮能重发。
func copilotToolArguments(raw string) json.RawMessage {
	if strings.TrimSpace(raw) == "" {
		// 无参调用有的上游给 ""，有的给 "{}"，统一成后者。
		return json.RawMessage(`{}`)
	}
	if gjson.Valid(raw) {
		return json.RawMessage(raw)
	}
	encoded, err := common.Marshal(raw)
	if err != nil {
		return json.RawMessage(`"tool arguments are not valid JSON"`)
	}
	return encoded
}

// selectChannel 为副驾这一次请求定下渠道：管理员钉了就用钉的，否则按他的分组走
// 正常选路（abilities 过滤、优先级与权重都在 CacheGetRandomSatisfiedChannel 里）。
//
// 钉选这一支刻意不做「这条渠道支不支持这个模型」的校验：副驾模型和渠道都是管理员
// 在同一个设置页里选的，配不上时让上游把真实原因说出来，比在这里拦一个笼统的
// 「渠道不支持该模型」更有用。
func (rc *relayCompleter) selectChannel(c *gin.Context, req copilot.CompletionRequest) (*model.Channel, error) {
	if req.ChannelID != 0 {
		// selectAll=true：SetupContextForSelectedChannel 要读 channel.Key 取密钥，
		// 省掉 key 的那个查询版本会让它拿到空密钥。
		channel, err := model.GetChannelById(req.ChannelID, true)
		if err != nil {
			return nil, fmt.Errorf("渠道 #%d 不存在: %w", req.ChannelID, err)
		}
		if channel.Status != common.ChannelStatusEnabled {
			return nil, fmt.Errorf("渠道 #%d 已禁用", req.ChannelID)
		}
		return channel, nil
	}

	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	channel, selectGroup, err := service.CacheGetRandomSatisfiedChannel(&service.RetryParam{
		Ctx:         c,
		TokenGroup:  usingGroup,
		ModelName:   req.Model,
		RequestPath: c.Request.URL.Path,
		Retry:       common.GetPointer(0),
	})
	if err != nil {
		return nil, fmt.Errorf("分组 %s 下模型 %s 无可用渠道: %w", selectGroup, req.Model, err)
	}
	if channel == nil {
		return nil, fmt.Errorf("分组 %s 下模型 %s 无可用渠道", selectGroup, req.Model)
	}
	return channel, nil
}

// copilotUpstreamErrorText 从 relay 写回的响应体里取出人能读的错误文本。
//
// 管理员必须能一眼分清「副驾自己的渠道挂了」和「你问的那个模型有问题」，所以
// 这里不吞掉上游原文，只在体积上做截断。
func copilotUpstreamErrorText(body []byte) string {
	if len(body) == 0 {
		return "上游未返回响应体"
	}
	var wrapper struct {
		Error any `json:"error"`
	}
	if err := common.Unmarshal(body, &wrapper); err == nil && wrapper.Error != nil {
		if openAIErr := dto.GetOpenAIError(wrapper.Error); openAIErr != nil && openAIErr.Message != "" {
			return truncateForCopilot(openAIErr.Message)
		}
	}
	return truncateForCopilot(string(body))
}

func truncateForCopilot(s string) string {
	trimmed := strings.TrimSpace(s)
	if runes := []rune(trimmed); len(runes) > copilotErrorBodyPreviewRunes {
		return string(runes[:copilotErrorBodyPreviewRunes]) + "…（已截断）"
	}
	return trimmed
}
