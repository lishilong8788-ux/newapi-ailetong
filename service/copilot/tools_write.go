package copilot

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/QuantumNous/new-api/model"
)

// 二期的写工具。每一个都必须 Mutates: true —— 闸门（loop.go 的 switch）判的就是
// 这个字段，漏标等于这个工具绕过确认直接写库。
//
// 只在 ModeAct 下注册（BuildRegistryForMode）。两层防线：mode 让模型看不见写工具，
// 闸门拦住万一看见了要用的。
func writeTools() []Tool {
	return []Tool{setChannelMarkupTool()}
}

func setChannelMarkupTool() Tool {
	return Tool{
		Name: "set_channel_markup",
		Description: "改一条渠道的默认利润率（default_markup）。卖价 = 进价 × (1 + 利润率)，" +
			"0.3 表示加价 30%，0 是合法值、含义是平进平出。这个操作会写库，并且需要管理员逐次点确认。" +
			"改之前建议先用 simulate_margin_impact 看这条渠道换成新利润率之后的毛利，" +
			"再把两个数一起说给管理员听 —— 它只改渠道级默认值，已经单独配过利润率的模型不受影响。",
		Parameters: objectSchema(map[string]any{
			"channel_id": map[string]any{
				"type":        "integer",
				"description": "渠道 id。",
				"minimum":     1,
			},
			"markup": map[string]any{
				"type":        "number",
				"description": fmt.Sprintf("新的渠道默认利润率，0.3 = 加价 30%%。范围 0~%g。", maxSimulateMarkup),
				"minimum":     0,
				"maximum":     maxSimulateMarkup,
			},
		}, "channel_id", "markup"),
		Mutates: true,
		Handler: handleSetChannelMarkup,
	}
}

func handleSetChannelMarkup(_ context.Context, args json.RawMessage) (any, error) {
	var in struct {
		ChannelID int      `json:"channel_id"`
		Markup    *float64 `json:"markup"`
	}
	if err := decodeArgs(args, &in); err != nil {
		return nil, err
	}
	channelID, err := requireChannelID(in.ChannelID)
	if err != nil {
		return nil, err
	}
	// 指针判 nil 而不是判零值：markup = 0 是合法配置（平进平出），当成"没传"会让
	// 模型无法表达这个意图。
	if in.Markup == nil {
		return nil, fmt.Errorf("markup 必填，不能省略")
	}
	// 复用模拟工具那一份校验：同一个概念只该有一个上界。批准只带工具名不带参数值，
	// 所以边界必须在 handler 里再判一次 —— 拿到批准不等于拿到了合法参数。
	if err := validateSimulateMarkup(*in.Markup); err != nil {
		return nil, err
	}

	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, err
	}
	settings := channel.GetOtherSettings()
	if settings.Cost == nil {
		return nil, fmt.Errorf("渠道 %d 还没配过成本价，先在渠道编辑抽屉里填进价，再调利润率", channelID)
	}
	previous := settings.Cost.DefaultMarkup
	settings.Cost.DefaultMarkup = in.Markup
	channel.SetOtherSettings(settings)
	if err := channel.Save(); err != nil {
		return nil, err
	}

	out := map[string]any{
		"channel_id":   channelID,
		"channel_name": channel.Name,
		"markup":       *in.Markup,
	}
	// 回报改动前的值，让管理员在对话里能看出这一步实际变了什么。nil 表示之前没配过。
	if previous != nil {
		out["previous_markup"] = *previous
	}
	return out, nil
}
