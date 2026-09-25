package copilot

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// 一期的九个只读工具。七个读 + 两个纯计算，全部 Mutates: false。
//
// 每个工具都是既有逻辑的薄包装：定价读 service.GetModelChannelRoutes（与广场
// 同一份缓存），毛利读 model.GetCostDaily*（与 /api/cost 同一批函数），卖价一律
// 交给 model.ResolveSellPrice + SellPriceToRatios 算。副驾自己不做业务算术——
// 它算一遍、报表算一遍，两个数对不上时没人知道该信哪个。
//
// 返回值全是小结构体/map：工具输出会原样进 LLM 上下文，一次几十 KB 的毛利明细
// 既烧钱又把有用的信息挤出窗口，所以列表类工具一律封顶。

// BuildRegistry 注册一期全部工具，顺序即 prompt 里的出场顺序。
func BuildRegistry() *Registry {
	r := NewRegistry()
	r.Register(searchModelsTool())
	r.Register(getModelPricingTool())
	r.Register(listChannelsTool())
	r.Register(getChannelCostTool())
	r.Register(queryMarginTool())
	r.Register(queryCostOverviewTool())
	r.Register(getOfficialPriceTool())
	r.Register(simulateSellPriceTool())
	r.Register(simulateMarginImpactTool())
	return r
}

const (
	// defaultListLimit 是列表类工具不传 limit 时的条数。
	defaultListLimit = 20
	// maxListLimit 是硬上限。不是性能考虑：返回值要进模型上下文，100 行渠道
	// 明细已经够把一轮对话的窗口占满。超界直接报错而不是静默钳制——模型看到
	// "limit=1000" 的回答里只有 100 行，会以为剩下的不存在。
	maxListLimit = 100

	// defaultWindowDays 与 controller/cost.go 的 parseCostTimeRange 对齐：
	// start/end 缺失或非正时看最近 30 天。
	defaultWindowDays = 30
	// maxWindowDays 与 controller/cost.go 的 costChannelModelMaxDays 对齐。
	maxWindowDays = 366

	secondsPerDay = 86400
)

// decodeArgs 把模型给的原始参数解进 out。空参数按空对象处理：模型对无必填参数的
// 工具经常直接发 null 或不发 arguments，那是合法调用而不是格式错误。
func decodeArgs(args json.RawMessage, out any) error {
	raw := strings.TrimSpace(string(args))
	if raw == "" || raw == "null" {
		return nil
	}
	if err := common.Unmarshal([]byte(raw), out); err != nil {
		return fmt.Errorf("参数不是合法 JSON 对象: %v", err)
	}
	return nil
}

// resolveLimit 校验列表条数。0/缺省取默认值，越界报错。
func resolveLimit(limit int) (int, error) {
	if limit == 0 {
		return defaultListLimit, nil
	}
	if limit < 0 || limit > maxListLimit {
		return 0, fmt.Errorf("limit 必须在 1~%d 之间，收到 %d", maxListLimit, limit)
	}
	return limit, nil
}

// resolveWindow 归一化 unix 秒时间窗，语义与 controller/cost.go 的
// parseCostTimeRange 一致：任一端缺失或非正就退回最近 defaultWindowDays 天。
//
// 比那边多一道上界：报表接口把 366 天的限制只加在交叉表上，而这里每个窗口都会
// 变成模型上下文里的一段数字，十年的日聚合没有可读性可言。
func resolveWindow(start, end int64) (int64, int64, error) {
	if start <= 0 || end <= 0 {
		end = common.GetTimestamp()
		start = end - defaultWindowDays*secondsPerDay
		return start, end, nil
	}
	if end < start {
		return 0, 0, fmt.Errorf("时间范围非法：end(%d) 早于 start(%d)", end, start)
	}
	if (end-start)/secondsPerDay > maxWindowDays {
		return 0, 0, fmt.Errorf("时间范围不得超过 %d 天", maxWindowDays)
	}
	return start, end, nil
}

// requireModelName 校验模型名这个必填参数。
func requireModelName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", fmt.Errorf("model 是必填参数")
	}
	return trimmed, nil
}

// requireChannelID 校验渠道 id。负数/0 不查库直接报错：渠道 id 从 1 开始，
// 0 是"模型没填"而不是一条渠道。
func requireChannelID(id int) (int, error) {
	if id <= 0 {
		return 0, fmt.Errorf("channel_id 必须是正整数，收到 %d", id)
	}
	return id, nil
}

// objectSchema 拼一个 JSON Schema 对象。required 直接给字段名，没有必填项传 nil。
func objectSchema(properties map[string]any, required ...string) map[string]any {
	schema := map[string]any{
		"type":       "object",
		"properties": properties,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

// usdPer1MFromRatio 把倍率还原成 USD / 1M tokens，是 SellPriceToRatios 那条
// 恒等式的逆运算（modelRatio = P × QuotaPerUnit ÷ 1e6）。
//
// 模型读倍率读不出贵贱——倍率 1 是 $2/M 还是 $20/M 取决于 QuotaPerUnit，而那是
// 个可改的站点配置。所以凡是往外报倍率的地方都同时报一个 USD 单价。
func usdPer1MFromRatio(ratio float64) float64 {
	if common.QuotaPerUnit <= 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
		return 0
	}
	return ratio * 1e6 / common.QuotaPerUnit
}

// quotaToUSD 把 quota 折成 USD，与 controller/cost.go 的库存对账同一个除法。
func quotaToUSD(quota int64) float64 {
	if common.QuotaPerUnit <= 0 {
		return 0
	}
	return float64(quota) / common.QuotaPerUnit
}

// adminReachableGroups 是管理员视角的全部分组。
//
// service.GetModelChannelRoutes 按调用方可达的分组过滤，公开目录传的是访客能看
// 见的那几个；副驾是管理员工具，少给一个分组就会漏掉整条私有线路，而运营问的往往
// 正是"为什么这条线没接量"。所以把倍率表和可用分组表的并集都给它。
func adminReachableGroups() map[string]string {
	groups := setting.GetUserUsableGroupsCopy()
	if groups == nil {
		groups = map[string]string{}
	}
	for group := range ratio_setting.GetGroupRatioCopy() {
		if _, ok := groups[group]; !ok {
			groups[group] = ""
		}
	}
	return groups
}

// parseChannelOtherSettings 解析渠道的 settings 列。
//
// 刻意不用 channel.GetOtherSettings()：那个方法在 JSON 解析失败时会把列清空并
// 【写库】自我修复（model/channel.go:1048），而副驾一期不允许任何写操作。解析
// 失败在这里是"这条渠道没有可读的配置"，报给模型，不动数据。
func parseChannelOtherSettings(channel *model.Channel) (dto.ChannelOtherSettings, error) {
	settings := dto.ChannelOtherSettings{}
	if channel == nil || strings.TrimSpace(channel.OtherSettings) == "" {
		return settings, nil
	}
	if err := common.UnmarshalJsonStr(channel.OtherSettings, &settings); err != nil {
		return settings, fmt.Errorf("渠道 %d 的 settings 字段不是合法 JSON，无法读取成本/折扣配置", channel.Id)
	}
	return settings, nil
}

// channelNamesByID 取 (id -> name)，给毛利明细贴渠道名用。
//
// 只 Select 两列：这条路径不需要 key，而渠道表里的 key 是最不该进 LLM 上下文的
// 字段。GetAllChannels 会把整行（含 key）读出来。
func channelNamesByID() map[int]string {
	var rows []struct {
		Id   int
		Name string
	}
	if err := model.DB.Model(&model.Channel{}).Select("id", "name").Find(&rows).Error; err != nil {
		common.SysError("copilot: failed to load channel names: " + err.Error())
		return nil
	}
	names := make(map[int]string, len(rows))
	for _, row := range rows {
		names[row.Id] = row.Name
	}
	return names
}
