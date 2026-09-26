package controller

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/copilot"
	"github.com/QuantumNous/new-api/setting/copilot_setting"

	"github.com/gin-gonic/gin"
)

// 运营副驾（Copilot）的 HTTP 层。整组挂 AdminAuth：所有工具都能读渠道进价和
// 成本毛利，密级与 /cost 同级。

// maxCopilotInputBytes 限制单条消息的长度。上限存在的理由是计费而不是存储：
// 输入会连同全部历史一起进 prompt，而且每一轮工具调用都要重发一次，一条 1MB
// 的粘贴会被放大成 MaxRounds 倍的 prompt token。32KB 约合上万 token，已经远超
// 正常提问。
const maxCopilotInputBytes = 32 * 1024

// maxCopilotHistoryMessages 限制带进 prompt 的历史条数。取尾部而不是头部：管理员
// 追问的上下文在最近几轮里。
const maxCopilotHistoryMessages = 200

// copilotAdminId 取当前管理员 id。AdminAuth 一定会设上它，这里再兜一次是防止
// 将来有人把路由挂到没有鉴权的组里——那种错误不会有编译错误，只会静默放行。
func copilotAdminId(c *gin.Context) (int, bool) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "未登录")
		return 0, false
	}
	return userId, true
}

// copilotSessionId 解析路径上的会话 id。
func copilotSessionId(c *gin.Context) (int, bool) {
	sessionId, err := strconv.Atoi(c.Param("id"))
	if err != nil || sessionId <= 0 {
		common.ApiErrorMsg(c, "invalid session id")
		return 0, false
	}
	return sessionId, true
}

// GetCopilotStatus 报告副驾是否可用。前端据此决定是渲染对话框还是渲染「去设置」
// 的引导，所以 enabled 和 configured 必须分开给：只有 enabled 一个字段的话，
// 「开了但没选模型」和「能用」在界面上就长得一样。
func GetCopilotStatus(c *gin.Context) {
	common.ApiSuccess(c, copilotStatusPayload(c.GetInt("role") >= common.RoleRootUser))
}

// copilotStatusPayload 是状态接口和配置接口共用的返回体。两个接口返回同一个形状，
// 前端保存完就能直接拿它刷新界面，不用再补一次 GET —— 少一次往返，也少一个
// 「保存成功但界面还是旧值」的窗口。
//
// canConfigure 决定前端把选择器渲染成可改还是只读。copilot_setting.* 是全局选项，
// 和设置页里其他选项同级，所以写权限跟 /api/option 一致是站长（root）：管理员能用
// 副驾，但不能替整站改它用哪个模型。
func copilotStatusPayload(canConfigure bool) gin.H {
	setting := copilot_setting.GetSetting()
	return gin.H{
		"enabled":       setting.Enabled,
		"configured":    copilot_setting.Configured(),
		"model":         copilot_setting.GetModel(),
		"channel_id":    setting.ChannelId,
		"max_rounds":    copilot_setting.GetMaxRounds(),
		"can_configure": canConfigure,
	}
}

// GetCopilotModels 列出副驾能选的「模型 + 渠道」组合。
//
// 分组取的是副驾发请求时真正用的那个分组（relayCompleter 把 UsingGroup 定成管理员
// 自己的分组），而不是他可见的全部分组：列出别的分组里的模型，选中后要到第一条
// 消息才报「无可用渠道」。
func GetCopilotModels(c *gin.Context) {
	userId, ok := copilotAdminId(c)
	if !ok {
		return
	}
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	groups := []string{userCache.Group}
	if userCache.Group == "auto" {
		groups = service.GetUserAutoGroup(userCache.Group)
	}
	common.ApiSuccess(c, gin.H{
		"group":  userCache.Group,
		"models": model.GetModelChannelOptions(groups),
	})
}

// maxCopilotModelNameBytes 与 abilities.model 列宽一致。存得下才谈得上路由：超长的
// 名字写进选项里只会在选渠道时匹配不到任何 ability。
const maxCopilotModelNameBytes = 255

// UpdateCopilotConfig 从副驾页面自己改开关、模型与钉渠道。
//
// 存在的理由是设置页藏得太深（系统设置 → 模型与路由 → 运营副驾），运营在对话框里
// 想换个模型却找不到那一页。写的是同一组选项键，所以两边永远同一份真相。
//
// 三个字段都是指针：只发 model 的请求不该顺手把 enabled 关掉。
func UpdateCopilotConfig(c *gin.Context) {
	var req struct {
		Enabled   *bool   `json:"enabled"`
		Model     *string `json:"model"`
		ChannelId *int    `json:"channel_id"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}

	updates := make(map[string]string, 3)
	if req.Enabled != nil {
		updates["copilot_setting.enabled"] = strconv.FormatBool(*req.Enabled)
	}
	if req.Model != nil {
		modelName := strings.TrimSpace(*req.Model)
		if len(modelName) > maxCopilotModelNameBytes {
			common.ApiErrorMsg(c, "模型名过长")
			return
		}
		updates["copilot_setting.model"] = modelName
	}
	if req.ChannelId != nil {
		channelId := *req.ChannelId
		if channelId < 0 {
			common.ApiErrorMsg(c, "渠道 ID 不合法")
			return
		}
		// 非 0 的钉渠道当场校验存在且启用。不校验的话，配一个已删除的渠道要等到
		// 下一条消息才失败，而那时报出来的是一句「选择副驾渠道失败」，指不回这里。
		if channelId > 0 {
			channel, err := model.GetChannelById(channelId, false)
			if err != nil {
				common.ApiErrorMsg(c, fmt.Sprintf("渠道 #%d 不存在", channelId))
				return
			}
			if channel.Status != common.ChannelStatusEnabled {
				common.ApiErrorMsg(c, fmt.Sprintf("渠道 #%d 已禁用", channelId))
				return
			}
		}
		updates["copilot_setting.channel_id"] = strconv.Itoa(channelId)
	}
	if len(updates) == 0 {
		common.ApiErrorMsg(c, "没有要更新的配置")
		return
	}

	// 一次事务写完：开关和模型分两次写会留下「开着但没模型」的中间态，而那个状态
	// 下前端是可以发消息的。
	if err := model.UpdateOptionsBulk(updates); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, copilotStatusPayload(true))
}

// GetCopilotSessions 列出当前管理员自己的会话。
func GetCopilotSessions(c *gin.Context) {
	userId, ok := copilotAdminId(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	sessions, total, err := model.GetCopilotSessions(userId, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":     sessions,
		"total":     total,
		"page":      pageInfo.GetPage(),
		"page_size": pageInfo.GetPageSize(),
	})
}

// CreateCopilotSession 新建会话。标题可以不传——第一条消息发出来的时候会补上。
func CreateCopilotSession(c *gin.Context) {
	userId, ok := copilotAdminId(c)
	if !ok {
		return
	}
	var req struct {
		Title string `json:"title"`
	}
	// 请求体允许为空：建会话不需要任何字段，解码失败不该拦住它。
	_ = common.DecodeJson(c.Request.Body, &req)
	session, err := model.CreateCopilotSession(userId, req.Title)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, session)
}

// copilotMessageView 是一条消息的对外形状。与落库的行的唯一区别是 tool_calls：
// 库里存的是一段 JSON 文本，直接丢给前端就是一个需要二次 parse 的字符串字段。
type copilotMessageView struct {
	Id      int    `json:"id"`
	Role    string `json:"role"`
	Content string `json:"content"`
	// Images 是相对路径，不是图片内容：前端拿着它去 /api/copilot/images 取图。
	// 不内联 base64 —— 那会让「打开一个有十张图的会话」变成一次几 MB 的 JSON。
	Images           []string           `json:"images,omitempty"`
	ToolCalls        []copilot.ToolCall `json:"tool_calls,omitempty"`
	ToolCallId       string             `json:"tool_call_id,omitempty"`
	PromptTokens     int                `json:"prompt_tokens"`
	CompletionTokens int                `json:"completion_tokens"`
	CreatedTime      int64              `json:"created_time"`
}

// GetCopilotSession 返回会话本身加它的全部消息。
func GetCopilotSession(c *gin.Context) {
	userId, ok := copilotAdminId(c)
	if !ok {
		return
	}
	sessionId, ok := copilotSessionId(c)
	if !ok {
		return
	}
	session, err := model.GetCopilotSession(sessionId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	messages, err := model.GetCopilotMessages(sessionId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]copilotMessageView, 0, len(messages))
	for _, msg := range messages {
		views = append(views, copilotMessageView{
			Id:               msg.Id,
			Role:             msg.Role,
			Content:          msg.Content,
			Images:           decodeCopilotImagePaths(msg.Images),
			ToolCalls:        decodeCopilotToolCalls(msg.ToolCalls),
			ToolCallId:       msg.ToolCallId,
			PromptTokens:     msg.PromptTokens,
			CompletionTokens: msg.CompletionTokens,
			CreatedTime:      msg.CreatedTime,
		})
	}
	common.ApiSuccess(c, gin.H{
		"session":  session,
		"messages": views,
	})
}

// DeleteCopilotSession 删除会话及其消息。
func DeleteCopilotSession(c *gin.Context) {
	userId, ok := copilotAdminId(c)
	if !ok {
		return
	}
	sessionId, ok := copilotSessionId(c)
	if !ok {
		return
	}
	if err := model.DeleteCopilotSession(sessionId, userId); err != nil {
		common.ApiError(c, err)
		return
	}
	// 库里的引用先没了，再删磁盘：反过来的顺序会在删目录成功、删库失败时留下一个
	// 打开就全是裂图的会话。图片按会话分目录，所以这里能一次删干净。
	service.RemoveCopilotSessionImageDir(sessionId)
	common.ApiSuccess(c, nil)
}

// GetCopilotImage 下发一张会话图片。
//
// 存在的理由是鉴权：面板只认 Authorization header（没有 cookie 兜底），所以
// `<img src="/api/...">` 取不到图，前端必须带着 token 拉 blob。既然要过这个
// 端点，归属校验就在这里做。
func GetCopilotImage(c *gin.Context) {
	userId, ok := copilotAdminId(c)
	if !ok {
		return
	}
	relativePath := strings.TrimSpace(c.Query("path"))
	if relativePath == "" {
		common.ApiErrorMsg(c, "缺少图片路径")
		return
	}

	// 路径的第一段是会话号，用它做归属校验。少了这一道，任何管理员都能翻别人
	// 会话里的截图 —— 而副驾的对话里全是经营数字。
	sessionSegment, _, found := strings.Cut(filepath.ToSlash(relativePath), "/")
	if !found {
		common.ApiErrorMsg(c, "图片路径不合法")
		return
	}
	sessionId, err := strconv.Atoi(sessionSegment)
	if err != nil || sessionId <= 0 {
		common.ApiErrorMsg(c, "图片路径不合法")
		return
	}
	owned, err := model.CopilotSessionOwnedBy(sessionId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !owned {
		common.ApiErrorMsg(c, "无权访问该图片")
		return
	}

	absolutePath, err := service.ResolveCopilotImagePath(relativePath)
	if err != nil {
		common.SysError("failed to resolve copilot image path: " + err.Error())
		common.ApiErrorMsg(c, "图片不可读")
		return
	}
	if _, err := os.Stat(absolutePath); err != nil {
		common.ApiErrorMsg(c, "图片已丢失")
		return
	}
	if mimeType := service.CopilotImageMimeType(relativePath); mimeType != "" {
		// 在 File 之前设置：它只在没有 Content-Type 时才自己嗅探。
		c.Header("Content-Type", mimeType)
	}
	c.File(absolutePath)
}

// decodeCopilotToolCalls 解析落库的 tool_calls。解不出来返回 nil 而不是报错：
// 一条历史消息的工具调用列表坏了，不该让整个会话打不开——正文还在，那才是
// 管理员要看的东西。
func decodeCopilotToolCalls(raw string) []copilot.ToolCall {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var calls []copilot.ToolCall
	if err := common.UnmarshalJsonStr(raw, &calls); err != nil {
		common.SysError("failed to decode copilot tool calls: " + err.Error())
		return nil
	}
	return calls
}

// encodeCopilotImagePaths 把相对路径列表编码成入库的那一列。空列表存空串而不是
// "[]"：绝大多数消息不带图，让老行和新行在库里长得一样。
func encodeCopilotImagePaths(paths []string) (string, error) {
	if len(paths) == 0 {
		return "", nil
	}
	encoded, err := common.Marshal(paths)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func decodeCopilotImagePaths(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var paths []string
	if err := common.UnmarshalJsonStr(raw, &paths); err != nil {
		common.SysError("failed to decode copilot image paths: " + err.Error())
		return nil
	}
	return paths
}

// CopilotChat 跑一轮对话，用 SSE 把过程推给前端。
//
// 不流式返回 token 增量：一期的 LLM 调用要拿到完整响应才能解析 tool_calls。SSE
// 在这里推的是「进展」——助手说的每一段话、它在调哪个工具、调了多久。管理员判断
// 副驾有没有在编数，靠的就是看见它真的查了。
func CopilotChat(c *gin.Context) {
	userId, ok := copilotAdminId(c)
	if !ok {
		return
	}
	sessionId, ok := copilotSessionId(c)
	if !ok {
		return
	}
	// 未就绪在这里就挡掉，绝不进循环：没选模型的情况下发起请求只会在上游路由
	// 阶段拿到一个「模型不存在」，那个错误指不到真正该改的地方。
	if !copilot_setting.Configured() {
		common.ApiErrorMsg(c, "运营副驾未启用或未选择模型，请在「系统设置 → 运营副驾」中开启并选择模型")
		return
	}

	var req struct {
		Message string `json:"message"`
		// Images 是 data URL。图片跟着这个请求一起来、在同一个请求里落盘，没有
		// 独立的上传端点：那会产生「传了但没发」的孤儿文件，而这个项目没有定期
		// 清理任务来收它们。
		Images []string `json:"images"`
		// Mode 决定写工具进不进这一轮的工具表。缺省（老客户端不发）按只读处理。
		Mode string `json:"mode"`
		// ApprovedTool 是管理员刚在确认框里点过头的工具名。
		//
		// 确认的语义是「带着这个字段重放整轮」而不是「续跑上一条 SSE」：SSE 是单向
		// 的，流已经在 confirm_required 那里结束了。
		ApprovedTool string `json:"approved_tool"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	userInput := strings.TrimSpace(req.Message)
	// 只贴图不说话是合法的提问（「这张表看出什么问题」的最短形式），所以空的判定
	// 是两者都空。
	if userInput == "" && len(req.Images) == 0 {
		common.ApiErrorMsg(c, "消息不能为空")
		return
	}
	if len(userInput) > maxCopilotInputBytes {
		common.ApiErrorMsg(c, "消息过长，请拆成多条发送")
		return
	}
	if len(req.Images) > service.MaxCopilotImages {
		common.ApiErrorMsg(c, fmt.Sprintf("一条消息最多 %d 张图片", service.MaxCopilotImages))
		return
	}

	session, err := model.GetCopilotSession(sessionId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	historyRows, err := model.GetCopilotMessages(sessionId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 图片先落盘，再落库。失败在这里还能回一个正常的 JSON 错误。
	imagePaths, err := service.SaveCopilotImages(sessionId, req.Images)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	encodedImages, err := encodeCopilotImagePaths(imagePaths)
	if err != nil {
		service.RemoveCopilotImageFiles(imagePaths)
		common.ApiErrorMsg(c, "保存图片失败")
		return
	}

	// 用户消息先落库，再开流。顺序是故意的：这一步失败要能回一个正常的 JSON
	// 错误，而响应头一旦变成 text/event-stream 就只能在流里报错了。而且管理员
	// 说过的话不能因为后面的模型调用失败而消失。
	userRow := &model.CopilotMessage{Role: copilot.RoleUser, Content: userInput, Images: encodedImages}
	if err := model.AppendCopilotMessages(sessionId, userId, []*model.CopilotMessage{userRow}); err != nil {
		// 库里没有这一行了，磁盘上的字节就成了永远不会被引用的孤儿。
		service.RemoveCopilotImageFiles(imagePaths)
		common.ApiError(c, err)
		return
	}
	if strings.TrimSpace(session.Title) == "" {
		// 只贴图的那次提问没有文字可做标题，留空会在会话列表里出现一行无名条目。
		titleSource := userInput
		if titleSource == "" {
			titleSource = fmt.Sprintf("[%d 张图片]", len(imagePaths))
		}
		if err := model.UpdateCopilotSessionTitle(sessionId, userId, titleSource); err != nil {
			// 标题只是列表上的一行字，失败不该中断对话。
			common.SysError("failed to set copilot session title: " + err.Error())
		}
	}

	setting := copilot_setting.GetSetting()
	helper.SetEventStreamHeaders(c)

	// terminalSent 防重复终止帧：循环正常收口时自己会发 done，前端只该收到一个
	// 终止事件。错误是 Run 的返回值而不是事件，所以 error 帧只能由这里补。
	terminalSent := false
	var promptTokens, completionTokens int
	toolDurations := map[string]int64{}
	emit := func(event copilot.Event) error {
		switch event.Type {
		case copilot.EventToolEnd:
			// 耗时只存在于事件里（copilot.Message 不带它），落库前得在这儿接住，
			// 否则重开会话时步骤行就没有耗时了。
			toolDurations[event.ToolCallID] = event.DurationMs
		case copilot.EventUsage:
			// 覆盖而不是累加：循环里的计数器是跨轮累计的，一次 Run 只发一条
			// usage，里面已经是整轮总数。累加会在它将来多发一条时直接翻倍。
			promptTokens = event.PromptTokens
			completionTokens = event.CompletionTokens
		case copilot.EventDone, copilot.EventError:
			terminalSent = true
		}
		// ObjectData 走 common.Marshal 并在每帧后 flush。不 flush 的进展事件比
		// 没有进展事件更糟：界面会一直空着，然后所有内容一次性砸出来。
		return helper.ObjectData(c, event)
	}

	newMessages, runErr := copilot.Run(c.Request.Context(), copilot.RunOptions{
		Completer: NewRelayCompleter(userId),
		Registry:  copilot.BuildRegistryForMode(req.Mode),
		Model:     copilot_setting.GetModel(),
		ChannelID: setting.ChannelId,
		MaxRounds: copilot_setting.GetMaxRounds(),
		History:   copilotHistory(historyRows),
		UserInput: userInput,
		// 批准只对这一轮有效：它从请求体来，不落库、不进会话状态。下一轮不带就
		// 又要重新点头。
		ApprovedTool: req.ApprovedTool,
		// 图片一直留在上下文里（历史里的也会被 copilotHistory 带回来）：追问
		// 「第三行那个为什么亏」时模型还得看得见图。代价是同一张图每轮重算一次
		// vision token。
		UserImages: imagePaths,
	}, emit)

	// 先落库再报错：失败的那一轮里，模型已经说过的话和已经调过的工具是管理员
	// 唯一的排查线索，丢了就只剩一句「出错了」。
	if rows := copilotRowsFromMessages(newMessages, promptTokens, completionTokens, toolDurations); len(rows) > 0 {
		if err := model.AppendCopilotMessages(sessionId, userId, rows); err != nil {
			common.SysError("failed to persist copilot messages: " + err.Error())
		}
	}

	if terminalSent {
		return
	}
	if runErr != nil {
		_ = helper.ObjectData(c, copilot.Event{Type: copilot.EventError, Text: runErr.Error()})
		return
	}
	_ = helper.ObjectData(c, copilot.Event{Type: copilot.EventDone})
}

// copilotHistory 把落库的行还原成循环要的消息，并截掉过长的历史。
//
// 取尾部而不是头部：管理员追问的上下文在最近几轮里。system prompt 不在这里，
// 循环自己会加。
func copilotHistory(rows []*model.CopilotMessage) []copilot.Message {
	if len(rows) > maxCopilotHistoryMessages {
		rows = rows[len(rows)-maxCopilotHistoryMessages:]
		// 截断点必须落在一条用户消息上。assistant 的 tool_calls 和它对应的 tool
		// 结果是成对的，把 tool 结果留下、发起它的 assistant 行切掉，上游会直接
		// 判非法对话返回 400。
		for len(rows) > 0 && rows[0].Role != copilot.RoleUser {
			rows = rows[1:]
		}
	}
	messages := make([]copilot.Message, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, copilot.Message{
			Role:       row.Role,
			Content:    row.Content,
			Images:     decodeCopilotImagePaths(row.Images),
			ToolCalls:  decodeCopilotToolCalls(row.ToolCalls),
			ToolCallID: row.ToolCallId,
		})
	}
	return messages
}

// copilotRowsFromMessages 把本轮新增的消息转成库行，并把整轮的 token 消耗记在
// 最后一条助手消息上。
//
// 为什么是整轮而不是逐条：copilot.Message 是钉住的契约，它不带 token 字段，
// 用量只能从 EventUsage 事件里累加，那是按轮而不是按消息给的。把总数记在收尾的
// 那条助手消息上，界面既能在末条下面显示「这一轮烧了多少」，整列求和也还是对的。
// toolDurations 是本轮 tool_call_id → 耗时（毫秒），由 EventToolEnd 收集。
func copilotRowsFromMessages(messages []copilot.Message, promptTokens, completionTokens int, toolDurations map[string]int64) []*model.CopilotMessage {
	rows := make([]*model.CopilotMessage, 0, len(messages))
	lastAssistant := -1
	for _, msg := range messages {
		row := &model.CopilotMessage{
			Role:       msg.Role,
			Content:    msg.Content,
			ToolCallId: msg.ToolCallID,
		}
		if msg.Role == copilot.RoleTool {
			row.DurationMs = toolDurations[msg.ToolCallID]
		}
		if len(msg.ToolCalls) > 0 {
			if encoded, err := common.Marshal(msg.ToolCalls); err == nil {
				row.ToolCalls = string(encoded)
			} else {
				common.SysError("failed to encode copilot tool calls: " + err.Error())
			}
		}
		if msg.Role == copilot.RoleAssistant {
			lastAssistant = len(rows)
		}
		rows = append(rows, row)
	}
	if lastAssistant >= 0 {
		rows[lastAssistant].PromptTokens = promptTokens
		rows[lastAssistant].CompletionTokens = completionTokens
	}
	return rows
}
