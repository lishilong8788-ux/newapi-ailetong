package model

import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// 运营副驾（Copilot）的会话存储。
//
// 这两张表刻意不 import service/copilot：service/copilot 的工具实现要查渠道、
// 查定价，一定会 import model，反向依赖会成环。所以 ToolCalls 在这一层只是一段
// 文本，序列化/反序列化由 controller 负责。
//
// 都放主库（DB）而不是日志库：会话是可读写的业务数据，要跟着主库一起备份，而
// 日志库在部分部署里是可以整表清掉的。

// ErrCopilotSessionNotFound 同时覆盖「不存在」和「不属于你」两种情况。两者返回
// 同一个错误是故意的：区分开会把「这个 id 确实存在」告诉不该知道的人。
var ErrCopilotSessionNotFound = errors.New("会话不存在或无权访问")

// copilotTitleMaxRunes 按字符（而非字节）截断标题。中文一个字 3 字节，按字节切
// 会把最后一个字切成半个，落库就是乱码。
const copilotTitleMaxRunes = 60

// CopilotSession 是一轮持续对话。软删除跟 PrefillGroup 一致：删除是管理员的
// 常规操作，留一行墓碑能在事后对账时看出「这里曾经有过一次会话」。
type CopilotSession struct {
	Id     int `json:"id"`
	UserId int `json:"user_id" gorm:"index"`
	// Title 由第一条用户消息截断得来，建会话时可以为空。
	Title       string         `json:"title" gorm:"type:varchar(255);default:''"`
	CreatedTime int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}

// CopilotMessage 是会话里的一条消息，结构与 copilot.Message 一一对应。
//
// PromptTokens/CompletionTokens 只在 assistant 行上有值：管理员要能看见副驾自己
// 烧了多少 token，否则一个会查十几次工具的助手是笔隐形账单。
type CopilotMessage struct {
	Id        int `json:"id"`
	SessionId int `json:"session_id" gorm:"index"`

	Role    string `json:"role" gorm:"type:varchar(32)"`
	Content string `json:"content" gorm:"type:text"`
	// Images 存 []string 相对路径的 JSON（图片本身落盘，见 service/copilot_image.go）。
	// 存路径而不是 base64：MySQL 的 text 上限 64 KB，压缩后的截图 base64 有
	// 130–270 KB，存进来会被截断。
	Images string `json:"images" gorm:"type:text"`
	// ToolCalls 存 []copilot.ToolCall 的 JSON。用 string 而不是 JSON 列类型：
	// text 在 SQLite/MySQL/PostgreSQL 上行为一致，而把 []byte 写进 PostgreSQL
	// 的 text 列要过驱动的 bytea 推断，是个没必要冒的风险。
	ToolCalls  string `json:"tool_calls" gorm:"type:text"`
	ToolCallId string `json:"tool_call_id" gorm:"type:varchar(128);default:''"`

	PromptTokens     int `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens int `json:"completion_tokens" gorm:"default:0"`

	// DurationMs 是这次工具调用的耗时，只在 Role == "tool" 的行上有值。
	//
	// 存它是因为耗时是「副驾真的查了系统」这件事的证据之一：实时流里步骤行显示
	// 耗时，重开旧会话却只剩名称，同一条记录在两个时刻长得不一样，而管理员回头
	// 复查往往正是在重开会话之后。
	DurationMs int64 `json:"duration_ms" gorm:"bigint;default:0"`

	CreatedTime int64 `json:"created_time" gorm:"bigint"`
}

// CopilotSessionTitle 把一段用户输入压成一行标题。
func CopilotSessionTitle(input string) string {
	title := strings.Join(strings.Fields(input), " ")
	if utf8.RuneCountInString(title) <= copilotTitleMaxRunes {
		return title
	}
	runes := []rune(title)
	return string(runes[:copilotTitleMaxRunes]) + "…"
}

// CreateCopilotSession 建一个空会话。标题允许为空，等第一条用户消息来了再补。
func CreateCopilotSession(userId int, title string) (*CopilotSession, error) {
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}
	now := common.GetTimestamp()
	session := &CopilotSession{
		UserId:      userId,
		Title:       CopilotSessionTitle(title),
		CreatedTime: now,
		UpdatedTime: now,
	}
	if err := DB.Create(session).Error; err != nil {
		common.SysError("failed to create copilot session: " + err.Error())
		return nil, errors.New("创建会话失败")
	}
	return session, nil
}

// GetCopilotSessions 列一个用户的会话，按最近活跃倒序。
//
// 排序用 updated_time 而不是 id：管理员回头继续聊的是「刚才那个」，不是「最后
// 建的那个」，这两者在翻出旧会话追问时会分叉。
func GetCopilotSessions(userId int, pageInfo *common.PageInfo) (sessions []*CopilotSession, total int64, err error) {
	if userId <= 0 {
		return nil, 0, errors.New("invalid user id")
	}
	query := DB.Model(&CopilotSession{}).Where("user_id = ?", userId)
	if err = query.Count(&total).Error; err != nil {
		common.SysError("failed to count copilot sessions: " + err.Error())
		return nil, 0, errors.New("获取会话列表失败")
	}
	err = query.Order("updated_time desc, id desc").
		Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).
		Find(&sessions).Error
	if err != nil {
		common.SysError("failed to list copilot sessions: " + err.Error())
		return nil, 0, errors.New("获取会话列表失败")
	}
	return sessions, total, nil
}

// GetCopilotSession 读一个会话。归属写在 WHERE 里而不是读出来再比：后者只要有
// 一个调用方忘了比，整个越权检查就没了。
func GetCopilotSession(id int, userId int) (*CopilotSession, error) {
	if id <= 0 || userId <= 0 {
		return nil, ErrCopilotSessionNotFound
	}
	var session CopilotSession
	if err := DB.Where("id = ? AND user_id = ?", id, userId).First(&session).Error; err != nil {
		return nil, ErrCopilotSessionNotFound
	}
	return &session, nil
}

// GetCopilotMessages 按写入顺序返回一个会话的消息。
//
// 先验归属再取消息：messages 表上没有 user_id，唯一能挡住越权的地方就是这次
// session 查询，所以它不能省。
//
// 排序用 id 而不是 created_time：created_time 只有秒级精度，同一秒里落库的
// assistant→tool→assistant 三条消息一旦乱序，喂回上游就是一段非法对话。
func GetCopilotMessages(sessionId int, userId int) ([]*CopilotMessage, error) {
	if _, err := GetCopilotSession(sessionId, userId); err != nil {
		return nil, err
	}
	var messages []*CopilotMessage
	if err := DB.Where("session_id = ?", sessionId).Order("id asc").Find(&messages).Error; err != nil {
		common.SysError("failed to list copilot messages: " + err.Error())
		return nil, errors.New("获取会话消息失败")
	}
	return messages, nil
}

// AppendCopilotMessages 追加消息并顺手把会话的活跃时间推到现在。
//
// 两件事在一个事务里：会话列表按 updated_time 排序，写了消息却没推时间的会话会
// 沉到列表底部，管理员会以为自己刚说的话丢了。
func AppendCopilotMessages(sessionId int, userId int, messages []*CopilotMessage) error {
	if len(messages) == 0 {
		return nil
	}
	if _, err := GetCopilotSession(sessionId, userId); err != nil {
		return err
	}
	now := common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		for _, msg := range messages {
			msg.SessionId = sessionId
			if msg.CreatedTime == 0 {
				msg.CreatedTime = now
			}
			if err := tx.Create(msg).Error; err != nil {
				return err
			}
		}
		return tx.Model(&CopilotSession{}).
			Where("id = ? AND user_id = ?", sessionId, userId).
			Update("updated_time", now).Error
	})
	if err != nil {
		common.SysError("failed to append copilot messages: " + err.Error())
		return errors.New("保存会话消息失败")
	}
	return nil
}

// UpdateCopilotSessionTitle 设置标题（同时推活跃时间）。
func UpdateCopilotSessionTitle(sessionId int, userId int, title string) error {
	if _, err := GetCopilotSession(sessionId, userId); err != nil {
		return err
	}
	err := DB.Model(&CopilotSession{}).
		Where("id = ? AND user_id = ?", sessionId, userId).
		Updates(map[string]any{
			"title":        CopilotSessionTitle(title),
			"updated_time": common.GetTimestamp(),
		}).Error
	if err != nil {
		common.SysError("failed to update copilot session title: " + err.Error())
		return errors.New("更新会话标题失败")
	}
	return nil
}

// DeleteCopilotSession 删会话。
//
// 会话软删（留墓碑），消息硬删：对话正文里可能有管理员粘进来的定价、渠道 key
// 片段之类的东西，「删了但还在库里」不是管理员按下删除时期待的语义。墓碑只剩
// 标题和时间，足够事后知道发生过什么。
func DeleteCopilotSession(sessionId int, userId int) error {
	if _, err := GetCopilotSession(sessionId, userId); err != nil {
		return err
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("session_id = ?", sessionId).Delete(&CopilotMessage{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", sessionId, userId).Delete(&CopilotSession{}).Error
	})
	if err != nil {
		common.SysError("failed to delete copilot session: " + err.Error())
		return errors.New("删除会话失败")
	}
	return nil
}

// CopilotSessionOwnedBy 报告这个会话是否属于该管理员。下发图片的端点用它做越权
// 拦截：图片路径是 URL 参数，没有这一道，任何管理员都能读到别人会话里的截图。
//
// 不复用 GetCopilotSession：那个函数在找不到时返回的是面向用户的错误文本，而
// 这里要的只是一个布尔量。
func CopilotSessionOwnedBy(sessionId int, userId int) (bool, error) {
	var count int64
	err := DB.Model(&CopilotSession{}).
		Where("id = ? AND user_id = ?", sessionId, userId).
		Count(&count).Error
	if err != nil {
		common.SysError("failed to check copilot session ownership: " + err.Error())
		return false, errors.New("校验会话归属失败")
	}
	return count > 0, nil
}
