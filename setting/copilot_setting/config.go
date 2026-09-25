package copilot_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// CopilotSetting 是运营副驾（Copilot）的开关与模型选择。
//
// 选项键（copilot_setting.enabled / .model / .channel_id / .max_rounds）是前后端
// 的公开契约，前端设置页按这些键读写，改名等于把已有部署的配置清空。
type CopilotSetting struct {
	// Enabled 默认 false，而且必须一直是 false。
	//
	// 这不是保守，是升级安全：副驾是一个能读全站渠道进价、成本毛利、用户消费的
	// 管理员助手，还会自己往上游发请求烧 token。如果升级后它自动开着，站长在
	// 不知情的情况下就多了一个有全库读权限的出网组件，而且账单已经在走了。
	// 开启必须是一次明确的人工动作。
	Enabled bool `json:"enabled"`

	// Model 是副驾自己用的模型（空 = 没选，视为未就绪）。没有默认值：默认填一个
	// 模型名就等于赌这个站点恰好配了它，赌输了是第一条消息才报错。
	Model string `json:"model"`

	// ChannelId 非 0 时把副驾的请求钉在这条渠道上。0 = 走正常路由。
	// 钉渠道的用处是把副驾的开销固定在一条自己的号上，方便单独对账。
	ChannelId int `json:"channel_id"`

	// MaxRounds 是工具调用的轮数上限。读取一律走 GetMaxRounds()，它会钳进合理
	// 区间——这个值直接乘在上游请求次数上，填错一个零就是一次对话几百次调用。
	MaxRounds int `json:"max_rounds"`
}

// 轮数区间。
//
// DefaultMaxRounds 与 service/copilot.DefaultMaxRounds 保持一致，但这里重复写一个
// 常量而不是 import service/copilot：setting 被 model 依赖，而 service/copilot 的
// 工具实现要 import model，引过来就是一条随时会成环的边。controller 的测试会断言
// 两个常量相等，数值漂移跑不掉。
const (
	DefaultMaxRounds = 8
	// MinMaxRounds 为 1：一轮都不让调工具的副驾只是个普通聊天框，配 0 更可能是
	// 手误而不是本意，所以 0 走默认值而不是钳到下界。
	MinMaxRounds = 1
	// MaxMaxRounds 为 20：9 个只读工具里最长的合理链路是 5 步，20 已经给足了
	// 模型走错再纠回来的余量，再往上就只是烧钱。
	MaxMaxRounds = 20
)

var copilotSetting = CopilotSetting{
	Enabled:   false,
	Model:     "",
	ChannelId: 0,
	MaxRounds: DefaultMaxRounds,
}

func init() {
	config.GlobalConfig.Register("copilot_setting", &copilotSetting)
}

func GetSetting() CopilotSetting {
	return copilotSetting
}

// GetModel 返回去掉首尾空白的模型名。设置页的输入框很容易带进一个尾随空格，而
// 模型名是精确匹配的，带空格的名字会在路由阶段变成「模型不存在」。
func GetModel() string {
	return strings.TrimSpace(copilotSetting.Model)
}

// Configured 表示副驾真的能用：开关开着，而且选了模型。
//
// 「开了但没选模型」要在状态接口里就报成未就绪，而不是等管理员发出第一条消息再
// 失败——后者看起来像功能坏了，前者才指向那个没填的输入框。
func Configured() bool {
	return copilotSetting.Enabled && GetModel() != ""
}

// GetMaxRounds 把轮数钳进 [MinMaxRounds, MaxMaxRounds]，0 视为未配置走默认值。
func GetMaxRounds() int {
	rounds := copilotSetting.MaxRounds
	if rounds == 0 {
		return DefaultMaxRounds
	}
	if rounds < MinMaxRounds {
		return MinMaxRounds
	}
	if rounds > MaxMaxRounds {
		return MaxMaxRounds
	}
	return rounds
}
