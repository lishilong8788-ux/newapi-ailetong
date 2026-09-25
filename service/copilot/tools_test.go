package copilot

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 这些测试守三件事：
//  1. 坏参数在查库之前就被挡下来（工具跑在 LLM 给的参数上，一个没校验的 limit
//     就是一条全表扫描）；
//  2. 模拟卖价与生产算术逐位一致（副驾算一个数、计费算另一个数，运营会照着副驾
//     那个去配价）；
//  3. 官方价一定带同步时效（过期官方价当现价用，折扣就会自信地报错数）。
//
// 需要库的读路径不在这里测：它们是既有查询函数的薄包装，真值由那些函数自己的
// 测试覆盖，这边只保证越界参数进不去。

func usd(v float64) *float64 { return &v }

// callTool 按工具名执行一次调用，模拟循环的调用方式。
func callTool(t *testing.T, registry *Registry, name string, args string) (any, error) {
	t.Helper()
	tool, ok := registry.Get(name)
	require.True(t, ok, "工具 %s 未注册", name)
	return tool.Handler(context.Background(), json.RawMessage(args))
}

func TestBuildRegistry_RegistersNineReadOnlyTools(t *testing.T) {
	registry := BuildRegistry()
	tools := registry.List()

	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	// 顺序也断言：prompt 里的出场顺序不稳，同一个问题在不同进程会走出不同的
	// 工具序列，eval 就没法断言了（types.go Register 的注释）。
	assert.Equal(t, []string{
		"search_models",
		"get_model_pricing",
		"list_channels",
		"get_channel_cost",
		"query_margin",
		"query_cost_overview",
		"get_official_price",
		"simulate_sell_price",
		"simulate_margin_impact",
	}, names)

	for _, tool := range tools {
		t.Run(tool.Name, func(t *testing.T) {
			assert.NotEmpty(t, tool.Description, "描述是模型选工具的唯一依据")
			require.NotNil(t, tool.Handler)
			// 一期只读。任何一个工具变成 true 都意味着循环该走人工确认了，
			// 而这一期没有那条路径。
			assert.False(t, tool.Mutates)

			require.NotNil(t, tool.Parameters)
			assert.Equal(t, "object", tool.Parameters["type"])
			properties, ok := tool.Parameters["properties"].(map[string]any)
			require.True(t, ok, "properties 必须是对象")
			for _, required := range requiredNames(t, tool.Parameters) {
				_, declared := properties[required]
				assert.True(t, declared, "required 里的 %s 没有在 properties 里声明", required)
			}
		})
	}
}

func requiredNames(t *testing.T, schema map[string]any) []string {
	t.Helper()
	raw, ok := schema["required"]
	if !ok {
		return nil
	}
	names, ok := raw.([]string)
	require.True(t, ok, "required 必须是字符串数组")
	return names
}

// 越界/缺失参数必须在查库之前失败。这些用例刻意不初始化数据库：一旦校验被绕过，
// 用例会以 nil 指针崩掉而不是静静通过。
func TestToolArgsValidation_RejectsBeforeQuerying(t *testing.T) {
	registry := BuildRegistry()

	cases := []struct {
		name string
		tool string
		args string
	}{
		{name: "limit 超过硬上限", tool: "search_models", args: `{"limit": 10000000}`},
		{name: "limit 为负", tool: "search_models", args: `{"limit": -1}`},
		{name: "列渠道 limit 超界", tool: "list_channels", args: `{"limit": 101}`},
		{name: "定价缺模型名", tool: "get_model_pricing", args: `{}`},
		{name: "定价模型名只有空格", tool: "get_model_pricing", args: `{"model": "   "}`},
		{name: "官方价缺模型名", tool: "get_official_price", args: `{}`},
		{name: "进价渠道 id 为 0", tool: "get_channel_cost", args: `{"channel_id": 0}`},
		{name: "进价渠道 id 为负", tool: "get_channel_cost", args: `{"channel_id": -7}`},
		{name: "毛利缺 group_by", tool: "query_margin", args: `{}`},
		{name: "毛利 group_by 非法", tool: "query_margin", args: `{"group_by": "user"}`},
		{name: "毛利时间窗倒置", tool: "query_margin", args: `{"group_by": "channel", "start": 2000, "end": 1000}`},
		{name: "毛利时间窗过宽", tool: "query_margin", args: `{"group_by": "channel", "start": 1, "end": 99999999999}`},
		{name: "总览时间窗倒置", tool: "query_cost_overview", args: `{"start": 2000, "end": 1000}`},
		{name: "模拟卖价渠道 id 缺失", tool: "simulate_sell_price", args: `{"model": "gpt-4o"}`},
		{name: "模拟卖价模型名缺失", tool: "simulate_sell_price", args: `{"channel_id": 3}`},
		{name: "模拟卖价利润率为负", tool: "simulate_sell_price", args: `{"channel_id": 3, "model": "gpt-4o", "markup": -0.1}`},
		// 上界 100 与 controller.validateChannelCostSettings 和 model 层的
		// maxSellMarkup 对齐，不自己另立一个数。
		{name: "模拟卖价利润率超界", tool: "simulate_sell_price", args: `{"channel_id": 3, "model": "gpt-4o", "markup": 1000}`},
		{name: "模拟毛利缺利润率", tool: "simulate_margin_impact", args: `{"channel_id": 3, "model": "gpt-4o"}`},
		{name: "模拟毛利利润率超界", tool: "simulate_margin_impact", args: `{"channel_id": 3, "model": "gpt-4o", "markup": 101}`},
		{name: "模拟毛利天数超界", tool: "simulate_margin_impact", args: `{"channel_id": 3, "model": "gpt-4o", "markup": 0.2, "days": 400}`},
		{name: "模拟毛利天数为负", tool: "simulate_margin_impact", args: `{"channel_id": 3, "model": "gpt-4o", "markup": 0.2, "days": -1}`},
		{name: "参数不是 JSON 对象", tool: "query_margin", args: `"channel"`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := callTool(t, registry, tc.tool, tc.args)
			require.Error(t, err, "越界参数必须报错，而不是带着它去查库")
			assert.Nil(t, result)
		})
	}
}

// 模拟卖价必须与生产算术逐位一致。副驾报一个数、计费收另一个数，运营会照着副驾
// 那个去配价，差额直接落在毛利上。
func TestResolveSellPriceView_AgreesWithProductionArithmetic(t *testing.T) {
	const upstreamModel = "copilot-sim-model"

	cases := []struct {
		name     string
		markup   float64
		inputUSD float64
		output   *float64
	}{
		// 0% 是真实回归点：channel-form.ts 曾用 markup > 0 判断"配过没配"，
		// 把平进平出当成未配置，整条卖价链静默退回老倍率计费（交接文档 7.1）。
		{name: "零利润率平进平出", markup: 0, inputUSD: 1.0, output: usd(4.0)},
		{name: "两成利润率", markup: 0.2, inputUSD: 1.0, output: usd(4.0)},
		{name: "只配 input", markup: 0.5, inputUSD: 2.5, output: nil},
		{name: "免费进价", markup: 0.3, inputUSD: 0, output: usd(0)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			markup := tc.markup
			cost := &dto.ChannelCostSettings{
				DefaultMarkup: &markup,
				Models: map[string]dto.ModelCostPrice{
					upstreamModel: {Input: usd(tc.inputUSD), Output: tc.output},
				},
			}

			want, ok := model.ResolveSellPrice(cost, upstreamModel)
			require.True(t, ok, "生产算术应当推得出卖价")
			wantRatios, ratioOK := model.SellPriceToRatios(want)

			view := resolveSellPriceView(cost, upstreamModel)
			require.True(t, view.Resolved)
			require.NotNil(t, view.Markup)
			assert.Equal(t, want.Markup, *view.Markup)
			assert.Equal(t, want.Input, view.InputUSDPer1M)
			assert.Equal(t, want.Output, view.OutputUSDPer1M)
			assert.Equal(t, want.CacheRead, view.CacheReadUSDPer1M)

			assert.Equal(t, ratioOK, view.Billable)
			if !ratioOK {
				assert.Nil(t, view.ModelRatio)
				return
			}
			require.NotNil(t, view.ModelRatio)
			assert.Equal(t, wantRatios.ModelRatio, *view.ModelRatio)
			assert.Equal(t, wantRatios.CompletionRatio, view.CompletionRatio)
			assert.Equal(t, wantRatios.CacheRatio, view.CacheRatio)
		})
	}
}

// 零利润率要真的产出"卖价 = 进价"，不是"没配价"。
func TestResolveSellPriceView_ZeroMarkupSellsAtCost(t *testing.T) {
	const upstreamModel = "copilot-zero-markup"
	zero := 0.0
	cost := &dto.ChannelCostSettings{
		DefaultMarkup: &zero,
		Models:        map[string]dto.ModelCostPrice{upstreamModel: {Input: usd(1.0), Output: usd(4.0)}},
	}

	view := resolveSellPriceView(cost, upstreamModel)
	require.True(t, view.Resolved, "0% 是合法利润率，不是未配置")
	require.True(t, view.Billable)
	require.NotNil(t, view.Markup)
	assert.Equal(t, 0.0, *view.Markup)
	require.NotNil(t, view.InputUSDPer1M)
	assert.Equal(t, 1.0, *view.InputUSDPer1M, "平进平出：卖价等于进价")
	require.NotNil(t, view.ModelRatio)
	// 倍率 = P × QuotaPerUnit ÷ 1e6，与 SellPriceToRatios 同一条恒等式。
	assert.Equal(t, 1.0*common.QuotaPerUnit/1e6, *view.ModelRatio)
}

// 显式给的利润率必须盖住存着的那个，包括盖住【模型级】覆盖值——只改渠道级
// default_markup 的话，已配模型覆盖的那一条会照旧用自己的值，调用方给的数被无声吞掉。
func TestCostSettingsWithMarkup_OverridesStoredAndModelLevelMarkup(t *testing.T) {
	const upstreamModel = "copilot-override-model"
	storedChannelMarkup := 0.2
	storedModelMarkup := 0.9
	cost := &dto.ChannelCostSettings{
		DefaultMarkup: &storedChannelMarkup,
		Models: map[string]dto.ModelCostPrice{
			upstreamModel: {Input: usd(1.0), Markup: &storedModelMarkup},
		},
	}

	stored := resolveSellPriceView(cost, upstreamModel)
	require.True(t, stored.Resolved)
	require.NotNil(t, stored.Markup)
	assert.Equal(t, 0.9, *stored.Markup, "模型级利润率优先于渠道级")

	simulated := resolveSellPriceView(costSettingsWithMarkup(cost, upstreamModel, 0.5), upstreamModel)
	require.True(t, simulated.Resolved)
	require.NotNil(t, simulated.Markup)
	assert.Equal(t, 0.5, *simulated.Markup)
	require.NotNil(t, simulated.InputUSDPer1M)
	assert.Equal(t, 1.5, *simulated.InputUSDPer1M)

	// 零利润率也要能盖掉一个非零的存量值，否则 simulate(0) 会读成"按存量算"。
	zeroed := resolveSellPriceView(costSettingsWithMarkup(cost, upstreamModel, 0), upstreamModel)
	require.True(t, zeroed.Resolved)
	require.NotNil(t, zeroed.Markup)
	assert.Equal(t, 0.0, *zeroed.Markup)

	// 模拟不得改动原配置：入参那份来自渠道行/缓存，就地改等于让一次"试算"
	// 悄悄改掉线上定价。
	require.NotNil(t, cost.Models[upstreamModel].Markup)
	assert.Equal(t, 0.9, *cost.Models[upstreamModel].Markup)
	require.NotNil(t, cost.DefaultMarkup)
	assert.Equal(t, 0.2, *cost.DefaultMarkup)
}

// 没配进价的模型不该因为"调用方给了利润率"就凭空有卖价。
func TestCostSettingsWithMarkup_UnpricedModelStaysUnresolved(t *testing.T) {
	cost := &dto.ChannelCostSettings{Models: map[string]dto.ModelCostPrice{"other-model": {Input: usd(1.0)}}}

	view := resolveSellPriceView(costSettingsWithMarkup(cost, "missing-model", 0.3), "missing-model")
	assert.False(t, view.Resolved)
	assert.NotEmpty(t, view.Reason)
	assert.False(t, view.Billable)
}

// 官方价必须带同步时效。过期官方价当现价用，折扣就会被自信地报错。
func TestGetOfficialPrice_SurfacesSyncedAtAndStaleDays(t *testing.T) {
	const modelName = "copilot-official-model"

	require.NoError(t, ratio_setting.UpdateOfficialModelRatioByJSONString(`{"copilot-official-model":0.04}`))
	require.NoError(t, ratio_setting.UpdateOfficialCompletionRatioByJSONString(`{"copilot-official-model":1.25}`))
	require.NoError(t, ratio_setting.UpdateOfficialCacheRatioByJSONString(`{"copilot-official-model":0.0375}`))
	originalSyncedAt := ratio_setting.GetOfficialRatioSyncedAt()
	syncedAt := common.GetTimestamp() - 9*secondsPerDay
	ratio_setting.SetOfficialRatioSyncedAt(syncedAt)
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateOfficialModelRatioByJSONString(""))
		require.NoError(t, ratio_setting.UpdateOfficialCompletionRatioByJSONString(""))
		require.NoError(t, ratio_setting.UpdateOfficialCacheRatioByJSONString(""))
		ratio_setting.SetOfficialRatioSyncedAt(originalSyncedAt)
	})

	result, err := callTool(t, BuildRegistry(), "get_official_price", `{"model":"copilot-official-model"}`)
	require.NoError(t, err)
	payload, ok := result.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, modelName, payload["model"])

	official, ok := payload["official"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, true, official["available"])
	assert.Equal(t, syncedAt, official["synced_at"])
	assert.Equal(t, true, official["synced"])
	assert.Equal(t, int64(9), official["stale_days"])
	assert.Equal(t, 0.04, official["model_ratio"])
	// 倍率对模型不可读，所以每处都配一个 USD 单价：0.04 × 1e6 ÷ 500000 = $0.08/M。
	assert.Equal(t, 0.04*1e6/common.QuotaPerUnit, official["input_usd_per_1m"])
	assert.Equal(t, 1.25, official["completion_ratio"])
	assert.Equal(t, 0.0375, official["cache_ratio"])

	// 从没同步过时 stale_days 必须是 nil 而不是 0：0 会被读成"今天刚同步的"。
	ratio_setting.SetOfficialRatioSyncedAt(0)
	result, err = callTool(t, BuildRegistry(), "get_official_price", `{"model":"copilot-official-model"}`)
	require.NoError(t, err)
	official, ok = result.(map[string]any)["official"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, false, official["synced"])
	assert.Nil(t, official["stale_days"])
	assert.NotEmpty(t, official["note"])
}

// 没有官方价记录的模型要说"没有"，不能让调用方拿兜底值去算折扣。
func TestGetOfficialPrice_MissingModelReportsUnavailable(t *testing.T) {
	require.NoError(t, ratio_setting.UpdateOfficialModelRatioByJSONString(""))

	result, err := callTool(t, BuildRegistry(), "get_official_price", `{"model":"copilot-no-official-price"}`)
	require.NoError(t, err)
	official, ok := result.(map[string]any)["official"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, false, official["available"])
	assert.NotContains(t, official, "model_ratio")
	assert.NotEmpty(t, official["note_missing"])
}

func TestResolveWindow_DefaultsToRecentWindow(t *testing.T) {
	start, end, err := resolveWindow(0, 0)
	require.NoError(t, err)
	// 与 controller/cost.go 的 parseCostTimeRange 同一个默认口径：最近 30 天。
	assert.Equal(t, int64(defaultWindowDays*secondsPerDay), end-start)

	start, end, err = resolveWindow(1_000_000, 1_086_400)
	require.NoError(t, err)
	assert.Equal(t, int64(1_000_000), start)
	assert.Equal(t, int64(1_086_400), end)
}
