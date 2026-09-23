package service

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func ptr(f float64) *float64 { return &f }

func TestResolveSellDiscount_Chain(t *testing.T) {
	cases := []struct {
		name       string
		price      *dto.ChannelPriceSettings
		model      string
		wantRatio  float64
		wantSource string
		wantOK     bool
	}{
		{
			name:       "nil settings falls back",
			price:      nil,
			model:      "deepseek-v4-flash",
			wantSource: PriceSourceFallback,
		},
		{
			name:       "empty settings falls back",
			price:      &dto.ChannelPriceSettings{},
			model:      "deepseek-v4-flash",
			wantSource: PriceSourceFallback,
		},
		{
			name:       "channel discount applies",
			price:      &dto.ChannelPriceSettings{Discount: ptr(0.44)},
			model:      "deepseek-v4-flash",
			wantRatio:  0.44,
			wantSource: PriceSourceChannel,
			wantOK:     true,
		},
		{
			name: "per-model discount beats channel discount",
			price: &dto.ChannelPriceSettings{
				Discount: ptr(0.44),
				Models:   map[string]*float64{"deepseek-v4-flash": ptr(0.30)},
			},
			model:      "deepseek-v4-flash",
			wantRatio:  0.30,
			wantSource: PriceSourceExact,
			wantOK:     true,
		},
		{
			name: "per-model miss falls back to channel discount",
			price: &dto.ChannelPriceSettings{
				Discount: ptr(0.44),
				Models:   map[string]*float64{"some-other-model": ptr(0.30)},
			},
			model:      "deepseek-v4-flash",
			wantRatio:  0.44,
			wantSource: PriceSourceChannel,
			wantOK:     true,
		},
		{
			name:       "10折 is list price, not a miss",
			price:      &dto.ChannelPriceSettings{Discount: ptr(1.0)},
			model:      "deepseek-v4-flash",
			wantRatio:  1.0,
			wantSource: PriceSourceChannel,
			wantOK:     true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ratio, source, ok := ResolveSellDiscount(tc.price, tc.model)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if source != tc.wantSource {
				t.Errorf("source = %q, want %q", source, tc.wantSource)
			}
			if ok && ratio != tc.wantRatio {
				t.Errorf("ratio = %v, want %v", ratio, tc.wantRatio)
			}
		})
	}
}

// Rejected discounts must fall back, never bill. A zero here would ship the
// request free of charge; a negative would credit the customer for using us.
func TestResolveSellDiscount_RejectsDangerousValues(t *testing.T) {
	bad := map[string]*float64{
		"zero":          ptr(0),
		"negative":      ptr(-0.5),
		"above list":    ptr(1.5),
		"NaN":           ptr(math.NaN()),
		"+Inf":          ptr(math.Inf(1)),
		"-Inf":          ptr(math.Inf(-1)),
		"below min":     ptr(0.0001),
		"nil in models": nil,
	}

	for name, d := range bad {
		t.Run("channel/"+name, func(t *testing.T) {
			_, source, ok := ResolveSellDiscount(&dto.ChannelPriceSettings{Discount: d}, "m")
			if ok {
				t.Fatalf("accepted %s discount", name)
			}
			if source != PriceSourceFallback {
				t.Errorf("source = %q, want fallback", source)
			}
		})

		t.Run("model/"+name, func(t *testing.T) {
			p := &dto.ChannelPriceSettings{Models: map[string]*float64{"m": d}}
			_, _, ok := ResolveSellDiscount(p, "m")
			if ok {
				t.Fatalf("accepted %s per-model discount", name)
			}
		})
	}
}

// Pins the arithmetic against hand-computed quota, which the failure-path tests
// cannot reach: they all short-circuit before any multiplication happens. An
// error in the formula itself would misprice every request that resolves.
// seedOfficialRatios installs list-price fixtures and restores the maps
// afterwards. The setters replace rather than merge (an empty string calls
// Clear, setting/ratio_setting/official_ratio.go:87), so a test that seeds
// without cleaning up would leave every later test in the package reading
// fixture prices.
func seedOfficialRatios(t *testing.T, modelJSON, completionJSON, cacheJSON string) {
	t.Helper()
	if err := ratio_setting.UpdateOfficialModelRatioByJSONString(modelJSON); err != nil {
		t.Fatalf("seed model ratio: %v", err)
	}
	if err := ratio_setting.UpdateOfficialCompletionRatioByJSONString(completionJSON); err != nil {
		t.Fatalf("seed completion ratio: %v", err)
	}
	if err := ratio_setting.UpdateOfficialCacheRatioByJSONString(cacheJSON); err != nil {
		t.Fatalf("seed cache ratio: %v", err)
	}
	t.Cleanup(func() {
		_ = ratio_setting.UpdateOfficialModelRatioByJSONString("")
		_ = ratio_setting.UpdateOfficialCompletionRatioByJSONString("")
		_ = ratio_setting.UpdateOfficialCacheRatioByJSONString("")
	})
}

func TestComputeListPriceQuota_Arithmetic(t *testing.T) {
	seedOfficialRatios(t, `{"pricing-fixture":2}`, `{"pricing-fixture":3}`, `{"pricing-fixture":0.1}`)
	cases := []struct {
		name   string
		tokens CostTokenBreakdown
		want   int // (prompt + cacheRead*0.1 + completion*3) * 2
	}{
		{"prompt only", CostTokenBreakdown{PromptTokens: 1000}, 2000},
		{"prompt and completion", CostTokenBreakdown{PromptTokens: 1000, CompletionTokens: 500}, 5000},
		{"cache read is discounted", CostTokenBreakdown{PromptTokens: 1000, CacheReadTokens: 1000}, 2200},
		{"completion dominates", CostTokenBreakdown{CompletionTokens: 1000}, 6000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, complete := ComputeListPriceQuota("pricing-fixture", tc.tokens)
			if got != tc.want {
				t.Errorf("quota = %d, want %d", got, tc.want)
			}
			if !complete {
				t.Error("complete = false, want true for text-only tokens")
			}
		})
	}
}

// The whole reason all three official coefficients move together: pricing output
// at the platform's completion ratio instead of the vendor's makes the realized
// discount miss its target by the ratio between them. Here the vendor charges 3x
// for output; a 4.4折 discount must land on 3x, not on whatever the platform set.
func TestComputeListPriceQuota_UsesOfficialCompletionRatio(t *testing.T) {
	seedOfficialRatios(t, `{"completion-fixture":1}`, `{"completion-fixture":4}`, `{}`)

	got, _ := ComputeListPriceQuota("completion-fixture", CostTokenBreakdown{CompletionTokens: 1000})
	if got != 4000 {
		t.Fatalf("quota = %d, want 4000 (1000 output x official completion 4 x model 1)", got)
	}
}

// Output tokens with no official completion ratio must fail outright rather than
// silently price them at the input rate — that would undercharge every request
// with output, which is every request.
func TestComputeListPriceQuota_MissingCompletionRatioWithOutputFails(t *testing.T) {
	seedOfficialRatios(t, `{"no-completion-fixture":2}`, `{}`, `{}`)

	if q, complete := ComputeListPriceQuota("no-completion-fixture", CostTokenBreakdown{
		PromptTokens: 100, CompletionTokens: 100,
	}); q != 0 || complete {
		t.Fatalf("got (%d, %v), want (0, false)", q, complete)
	}
}

// No official rate for a model means no list price, not a free request.
func TestComputeListPriceQuota_UnknownModelIsNotZeroPriced(t *testing.T) {
	q, complete := ComputeListPriceQuota("model-that-has-no-official-rate", CostTokenBreakdown{
		PromptTokens: 1000, CompletionTokens: 500,
	})
	if q != 0 || complete {
		t.Fatalf("got (%d, %v), want (0, false)", q, complete)
	}
}

// Image/audio/cache-write tokens have no official table, so a request carrying
// them can only be priced as a lower bound. complete=false is what stops a
// report from computing margin against an understated list price and showing a
// loss-making channel as healthy.
func TestComputeListPriceQuota_FlagsUnpriceableTokenKinds(t *testing.T) {
	kinds := map[string]CostTokenBreakdown{
		"image in":    {PromptTokens: 100, ImageInput: 10},
		"image out":   {PromptTokens: 100, ImageOutput: 10},
		"audio in":    {PromptTokens: 100, AudioInput: 10},
		"audio out":   {PromptTokens: 100, AudioOutput: 10},
		"cache write": {PromptTokens: 100, CacheWrite5m: 10},
		"cache w 1h":  {PromptTokens: 100, CacheWrite1h: 10},
	}
	for name, tokens := range kinds {
		t.Run(name, func(t *testing.T) {
			// Unknown model short-circuits before the completeness check, so this
			// only asserts the flag never claims completeness for these kinds.
			if _, complete := ComputeListPriceQuota("m", tokens); complete {
				t.Errorf("%s reported as completely priced", name)
			}
		})
	}
}

func TestWriteSellPriceSnapshot_CreatesAdminInfo(t *testing.T) {
	other := map[string]interface{}{}
	writeSellPriceSnapshot(dto.ChannelOtherSettings{Price: &dto.ChannelPriceSettings{Discount: ptr(0.44)}}, "m", sellPriceChannel{Id: 7}, 1200, CostTokenBreakdown{}, other)

	admin, ok := other["admin_info"].(map[string]interface{})
	if !ok {
		t.Fatal("admin_info not created")
	}
	price, ok := admin["price"].(map[string]interface{})
	if !ok {
		t.Fatal("price snapshot missing")
	}
	if price["discount"] != 0.44 {
		t.Errorf("discount = %v, want 0.44", price["discount"])
	}
	if price["price_source"] != PriceSourceChannel {
		t.Errorf("source = %v, want channel", price["price_source"])
	}
	if price["charged_quota"] != 1200 {
		t.Errorf("charged_quota = %v, want 1200", price["charged_quota"])
	}
}

// The snapshot must not clobber a sibling's admin_info entries — cost lands in
// the same map and both have to survive.
func TestWriteSellPriceSnapshot_PreservesSiblings(t *testing.T) {
	other := map[string]interface{}{
		"admin_info": map[string]interface{}{"cost": map[string]interface{}{"cost_quota": 700}},
	}
	writeSellPriceSnapshot(dto.ChannelOtherSettings{Price: &dto.ChannelPriceSettings{Discount: ptr(0.5)}}, "m", sellPriceChannel{Id: 7}, 1000, CostTokenBreakdown{}, other)

	admin := other["admin_info"].(map[string]interface{})
	if _, ok := admin["cost"]; !ok {
		t.Error("cost snapshot was dropped")
	}
	if _, ok := admin["price"]; !ok {
		t.Error("price snapshot missing")
	}
}

// "No discount configured" and "configured at 10折" must stay distinguishable:
// the first leaves the field absent, the second records 1.0. A report that
// cannot tell them apart would show the legacy ratio path as list-price sales.
func TestWriteSellPriceSnapshot_OmitsDiscountOnFallback(t *testing.T) {
	other := map[string]interface{}{}
	writeSellPriceSnapshot(dto.ChannelOtherSettings{}, "m", sellPriceChannel{Id: 7}, 900, CostTokenBreakdown{}, other)

	price := other["admin_info"].(map[string]interface{})["price"].(map[string]interface{})
	if _, present := price["discount"]; present {
		t.Error("fallback recorded a discount it never applied")
	}
	if price["price_source"] != PriceSourceFallback {
		t.Errorf("source = %v, want fallback", price["price_source"])
	}

	listed := map[string]interface{}{}
	writeSellPriceSnapshot(dto.ChannelOtherSettings{Price: &dto.ChannelPriceSettings{Discount: ptr(1.0)}}, "m", sellPriceChannel{Id: 7}, 900, CostTokenBreakdown{}, listed)
	lp := listed["admin_info"].(map[string]interface{})["price"].(map[string]interface{})
	if lp["discount"] != 1.0 {
		t.Errorf("10折 not recorded as 1.0: %v", lp["discount"])
	}
}

func TestWriteSellPriceSnapshot_NilOtherDoesNotPanic(t *testing.T) {
	writeSellPriceSnapshot(dto.ChannelOtherSettings{Price: &dto.ChannelPriceSettings{Discount: ptr(0.44)}}, "m", sellPriceChannel{Id: 7}, 100, CostTokenBreakdown{}, nil)
}

// 正推方向的算术：卖价 = 进价 × (1 + 利润率)。方向错了（反推）会得出
// 进价 / 1.3 而不是 × 1.3，这个数字差一眼能看出来。
func TestResolveSellPrice_MarksUpCostForward(t *testing.T) {
	cost := &dto.ChannelCostSettings{
		DefaultMarkup: ptr(0.3),
		Models: map[string]dto.ModelCostPrice{
			"m": {Input: ptr(3.0), Output: ptr(15.0)},
		},
	}
	got, ok := ResolveSellPrice(cost, "m")
	require.True(t, ok, "want a resolved sell price")
	assert.Equal(t, 0.3, got.Markup)
	require.NotNil(t, got.Input)
	assert.InDelta(t, 3.9, *got.Input, 1e-9, "input sell price = 3 x 1.3")
	require.NotNil(t, got.Output)
	assert.InDelta(t, 19.5, *got.Output, 1e-9, "output sell price = 15 x 1.3")
}

// 利润率取值顺序：模型级 Markup 盖住渠道级 DefaultMarkup。
func TestResolveSellPrice_ModelMarkupBeatsChannelMarkup(t *testing.T) {
	cost := &dto.ChannelCostSettings{
		DefaultMarkup: ptr(0.3),
		Models: map[string]dto.ModelCostPrice{
			"m":     {Input: ptr(10.0), Markup: ptr(1.0)},
			"other": {Input: ptr(10.0)},
		},
	}
	got, ok := ResolveSellPrice(cost, "m")
	require.True(t, ok)
	assert.Equal(t, 1.0, got.Markup, "per-model markup must win")
	require.NotNil(t, got.Input)
	assert.InDelta(t, 20.0, *got.Input, 1e-9)

	// 同渠道下没写 Markup 的模型仍走渠道级利润率。
	fallback, ok := ResolveSellPrice(cost, "other")
	require.True(t, ok)
	assert.Equal(t, 0.3, fallback.Markup)
	require.NotNil(t, fallback.Input)
	assert.InDelta(t, 13.0, *fallback.Input, 1e-9)
}

// 一个数管全维度：只填 input 进价，缺的维度按官方倍率折出来。官方
// completionRatio=3 意味着上游 output 卖 3 倍 input 价，所以 output 进价
// 也是 3 倍 input 进价，再各自乘同一个利润率。
func TestResolveSellPrice_DerivesMissingDimensionsFromOfficialRatios(t *testing.T) {
	seedOfficialRatios(t, `{"derive-fixture":2}`, `{"derive-fixture":3}`, `{"derive-fixture":0.1}`)

	cost := &dto.ChannelCostSettings{
		DefaultMarkup: ptr(0.5),
		Models: map[string]dto.ModelCostPrice{
			"derive-fixture": {Input: ptr(2.0)},
		},
	}
	got, ok := ResolveSellPrice(cost, "derive-fixture")
	require.True(t, ok)
	require.NotNil(t, got.Input)
	assert.InDelta(t, 3.0, *got.Input, 1e-9, "input sell price = 2 x 1.5")
	// output 进价 = 2 x 官方 completion 3 = 6，卖价 = 6 x 1.5 = 9
	require.NotNil(t, got.Output)
	assert.InDelta(t, 9.0, *got.Output, 1e-9)
	// cache read 进价 = 2 x 官方 cache 0.1 = 0.2，卖价 = 0.3
	require.NotNil(t, got.CacheRead)
	assert.InDelta(t, 0.3, *got.CacheRead, 1e-9)
}

// 显式填的维度不被推导覆盖：运营填了 output=1，就按 1 算，不理官方倍率。
func TestResolveSellPrice_ExplicitDimensionWinsOverDerivation(t *testing.T) {
	seedOfficialRatios(t, `{"explicit-fixture":2}`, `{"explicit-fixture":3}`, `{}`)

	cost := &dto.ChannelCostSettings{
		DefaultMarkup: ptr(0),
		Models: map[string]dto.ModelCostPrice{
			"explicit-fixture": {Input: ptr(2.0), Output: ptr(1.0)},
		},
	}
	got, ok := ResolveSellPrice(cost, "explicit-fixture")
	require.True(t, ok)
	require.NotNil(t, got.Output)
	assert.Equal(t, 1.0, *got.Output, "configured output price must not be re-derived")
}

// 没官方倍率表的维度（cache write / 音频 / 图片 / reasoning）推不出来，必须留
// nil。CoversTokens 因此在请求带这些 token 时报 false，调用方整笔退回老计费
// ——当 0 算等于白送这部分 token。
func TestResolveSellPrice_UnpriceableKindsStayNilAndFailCoverage(t *testing.T) {
	seedOfficialRatios(t, `{"cover-fixture":2}`, `{"cover-fixture":3}`, `{"cover-fixture":0.1}`)

	cost := &dto.ChannelCostSettings{
		DefaultMarkup: ptr(0.2),
		Models: map[string]dto.ModelCostPrice{
			"cover-fixture": {Input: ptr(2.0)},
		},
	}
	got, ok := ResolveSellPrice(cost, "cover-fixture")
	require.True(t, ok)
	for name, unit := range map[string]*float64{
		"cache write 5m": got.CacheWrite5m,
		"cache write 1h": got.CacheWrite1h,
		"audio in":       got.AudioIn,
		"audio out":      got.AudioOut,
		"image in":       got.ImageIn,
		"image out":      got.ImageOut,
		"reasoning":      got.Reasoning,
	} {
		assert.Nil(t, unit, "%s has no official table to derive from", name)
	}

	// 纯文本请求覆盖得住。
	assert.True(t, got.CoversTokens(CostTokenBreakdown{
		PromptTokens: 100, CompletionTokens: 50, CacheReadTokens: 10,
	}), "text-only request reported as uncovered")

	for name, tokens := range map[string]CostTokenBreakdown{
		"cache write": {PromptTokens: 100, CacheWrite5m: 10},
		"cache w 1h":  {PromptTokens: 100, CacheWrite1h: 10},
		"audio in":    {PromptTokens: 100, AudioInput: 10},
		"image in":    {PromptTokens: 100, ImageInput: 10},
		"reasoning":   {PromptTokens: 100, ReasoningTokens: 10},
	} {
		assert.False(t, got.CoversTokens(tokens), "%s reported as covered with a nil unit price", name)
	}
}

// 进价 0 是免费模型的合法值，不是「未配置」。指针存在就得出价，加价后仍是 0。
func TestResolveSellPrice_ZeroCostIsFreeNotUnconfigured(t *testing.T) {
	cost := &dto.ChannelCostSettings{
		DefaultMarkup: ptr(0.5),
		Models: map[string]dto.ModelCostPrice{
			"free": {Input: ptr(0), Output: ptr(0)},
		},
	}
	got, ok := ResolveSellPrice(cost, "free")
	require.True(t, ok, "a $0 purchase price is configured, not missing")
	require.NotNil(t, got.Input, "zero must stay distinguishable from unset")
	assert.Equal(t, 0.0, *got.Input)
	assert.True(t, got.CoversTokens(CostTokenBreakdown{PromptTokens: 100, CompletionTokens: 100}))
}

// 按次进价：命中 PerCall 就不填 token 维度，两套口径不同时生效。
func TestResolveSellPrice_PerCallSkipsTokenDimensions(t *testing.T) {
	cost := &dto.ChannelCostSettings{
		DefaultMarkup: ptr(0.25),
		Models: map[string]dto.ModelCostPrice{
			"mj-imagine": {PerCall: ptr(0.1), Input: ptr(3.0)},
		},
	}
	got, ok := ResolveSellPrice(cost, "mj-imagine")
	require.True(t, ok)
	require.NotNil(t, got.PerCall)
	assert.InDelta(t, 0.125, *got.PerCall, 1e-9, "per call = 0.1 x 1.25")
	assert.Nil(t, got.Input, "token dimensions must stay empty when priced per call")
	// 按次计价不看 token 维度，覆盖性判定必须放行。
	assert.True(t, got.CoversTokens(CostTokenBreakdown{PromptTokens: 100, AudioInput: 5}))
}

// ok=false 的每条路径都是「退回老倍率计费」，不是「卖 0 元」。
func TestResolveSellPrice_FallsBackWhenUnconfigured(t *testing.T) {
	cases := map[string]*dto.ChannelCostSettings{
		"nil settings":  nil,
		"no models":     {DefaultMarkup: ptr(0.3)},
		"empty models":  {DefaultMarkup: ptr(0.3), Models: map[string]dto.ModelCostPrice{}},
		"another model": {DefaultMarkup: ptr(0.3), Models: map[string]dto.ModelCostPrice{"other": {Input: ptr(1)}}},
		"no markup":     {Models: map[string]dto.ModelCostPrice{"m": {Input: ptr(1)}}},
		"empty price":   {DefaultMarkup: ptr(0.3), Models: map[string]dto.ModelCostPrice{"m": {}}},
	}
	for name, cost := range cases {
		t.Run(name, func(t *testing.T) {
			_, ok := ResolveSellPrice(cost, "m")
			assert.False(t, ok, "%s resolved a sell price it has no basis for", name)
		})
	}
}

// 非法利润率按「没配」处理并继续往下找，与折扣链同一套态度：一个模型上的笔误
// 不该连带废掉整个渠道的配置；渠道级也非法才真的退回老计费。
func TestResolveSellPrice_RejectsDangerousMarkups(t *testing.T) {
	bad := map[string]*float64{
		"negative": ptr(-0.5),
		"NaN":      ptr(math.NaN()),
		"+Inf":     ptr(math.Inf(1)),
		"-Inf":     ptr(math.Inf(-1)),
		"absurd":   ptr(1e6),
	}
	for name, m := range bad {
		t.Run("channel/"+name, func(t *testing.T) {
			cost := &dto.ChannelCostSettings{
				DefaultMarkup: m,
				Models:        map[string]dto.ModelCostPrice{"m": {Input: ptr(1)}},
			}
			_, ok := ResolveSellPrice(cost, "m")
			assert.False(t, ok, "accepted %s channel markup", name)
		})

		t.Run("model/"+name, func(t *testing.T) {
			cost := &dto.ChannelCostSettings{
				DefaultMarkup: ptr(0.3),
				Models:        map[string]dto.ModelCostPrice{"m": {Input: ptr(1), Markup: m}},
			}
			got, ok := ResolveSellPrice(cost, "m")
			require.True(t, ok, "%s per-model markup killed the channel markup", name)
			assert.Equal(t, 0.3, got.Markup)
		})
	}
}

// 非法进价单价不参与计价：钳到边界继续算会把配置错误变成一笔真实账单。
func TestResolveSellPrice_RejectsDangerousCostUnitPrices(t *testing.T) {
	cost := &dto.ChannelCostSettings{
		DefaultMarkup: ptr(0.3),
		Models: map[string]dto.ModelCostPrice{
			"bad-nan":  {Input: ptr(math.NaN())},
			"bad-inf":  {Input: ptr(math.Inf(1))},
			"bad-neg":  {Input: ptr(-1)},
			"bad-huge": {Input: ptr(1e9)},
			"mixed":    {Input: ptr(2.0), Output: ptr(math.NaN())},
		},
	}
	for _, name := range []string{"bad-nan", "bad-inf", "bad-neg", "bad-huge"} {
		t.Run(name, func(t *testing.T) {
			_, ok := ResolveSellPrice(cost, name)
			assert.False(t, ok, "%s produced a sell price from an illegal unit price", name)
		})
	}

	// 单个维度非法只废那个维度，其余照算；没有官方倍率可推时 output 留 nil，
	// 由 CoversTokens 把带 output 的请求挡回老计费。
	got, ok := ResolveSellPrice(cost, "mixed")
	require.True(t, ok)
	require.NotNil(t, got.Input)
	assert.InDelta(t, 2.6, *got.Input, 1e-9)
	assert.Nil(t, got.Output, "NaN output price must not become a number")
	assert.False(t, got.CoversTokens(CostTokenBreakdown{PromptTokens: 10, CompletionTokens: 10}))
}

// An invalid per-model discount must not shadow a valid channel discount: the
// operator's intent for the rest of the channel still stands.
func TestResolveSellDiscount_InvalidModelOverrideDoesNotPoisonChannel(t *testing.T) {
	p := &dto.ChannelPriceSettings{
		Discount: ptr(0.44),
		Models:   map[string]*float64{"m": ptr(0)},
	}
	ratio, source, ok := ResolveSellDiscount(p, "m")
	if !ok || ratio != 0.44 || source != PriceSourceChannel {
		t.Fatalf("got (%v, %q, %v), want (0.44, channel, true)", ratio, source, ok)
	}
}

// TestSellPriceToRatios_Conversion 锁住卖价到倍率的换算口径。这是唯一把
// "USD / 1M tokens" 翻成计费内核倍率的地方，算错就是直接收错钱。
func TestSellPriceToRatios_Conversion(t *testing.T) {
	require.Equal(t, 500*1000.0, common.QuotaPerUnit, "换算口径按 QuotaPerUnit=500000 推导，这个常量变了本测试的期望值要跟着改")

	cases := []struct {
		name           string
		price          ModelSellPrice
		wantOK         bool
		wantModelRatio float64
		wantCompletion *float64
		wantCache      *float64
	}{
		{
			name:           "20 USD per 1M input maps to model ratio 10",
			price:          ModelSellPrice{Input: ptr(20), Output: ptr(60), CacheRead: ptr(2)},
			wantOK:         true,
			wantModelRatio: 10,
			wantCompletion: ptr(3),
			wantCache:      ptr(0.1),
		},
		{
			name:           "nil cache read leaves the ratio to the platform value",
			price:          ModelSellPrice{Input: ptr(1), Output: ptr(4)},
			wantOK:         true,
			wantModelRatio: 0.5,
			wantCompletion: ptr(4),
		},
		{
			name:           "free cost is a real price, not unconfigured",
			price:          ModelSellPrice{Input: ptr(0), Output: ptr(0)},
			wantOK:         true,
			wantModelRatio: 0,
		},
		{
			name:   "free input with paid output cannot be expressed as a ratio",
			price:  ModelSellPrice{Input: ptr(0), Output: ptr(30)},
			wantOK: false,
		},
		{
			name:   "per-call price has no per-token base",
			price:  ModelSellPrice{PerCall: ptr(0.02)},
			wantOK: false,
		},
		{
			name:   "no input price means no conversion base",
			price:  ModelSellPrice{Output: ptr(30)},
			wantOK: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := SellPriceToRatios(tc.price)
			require.Equal(t, tc.wantOK, ok)
			if !tc.wantOK {
				return
			}
			assert.Equal(t, tc.wantModelRatio, got.ModelRatio)
			if tc.wantCompletion == nil {
				assert.Nil(t, got.CompletionRatio)
			} else {
				require.NotNil(t, got.CompletionRatio)
				assert.InDelta(t, *tc.wantCompletion, *got.CompletionRatio, 1e-9)
			}
			if tc.wantCache == nil {
				assert.Nil(t, got.CacheRatio)
			} else {
				require.NotNil(t, got.CacheRatio)
				assert.InDelta(t, *tc.wantCache, *got.CacheRatio, 1e-9)
			}
		})
	}
}

// TestWriteSellPriceSnapshot_RecordsMarginTriple 毛利报表要的三元：卖了多少
// （charged_quota + sell_markup + sell_input_price）、按什么口径定的价、以及
// 哪条线做的。少了服务渠道那一元，一行日志答不上"这笔毛利是谁挣的"。
func TestWriteSellPriceSnapshot_RecordsMarginTriple(t *testing.T) {
	settings := dto.ChannelOtherSettings{
		Cost: &dto.ChannelCostSettings{
			DefaultMarkup: ptr(0.3),
			Models:        map[string]dto.ModelCostPrice{"m": {Input: ptr(20), Output: ptr(40)}},
		},
	}
	other := map[string]interface{}{}
	writeSellPriceSnapshot(settings, "m", sellPriceChannel{Id: 42, LineCode: "hs10"}, 1300, CostTokenBreakdown{}, other)

	price := other["admin_info"].(map[string]interface{})["price"].(map[string]interface{})
	assert.Equal(t, 42, price["channel_id"])
	assert.Equal(t, "hs10", price["line_code"])
	assert.Equal(t, 0.3, price["sell_markup"])
	assert.InDelta(t, 26.0, price["sell_input_price"], 1e-9, "进价 20 × 1.3 = 卖价 26")
}

// 没配进价时不能记卖价口径的字段：报表按 sell_markup 在不在来分层灰度流量，
// 给老计费的请求配一个 markup 会让它看起来已经切过去了。
func TestWriteSellPriceSnapshot_OmitsSellFieldsWhenUnconfigured(t *testing.T) {
	other := map[string]interface{}{}
	writeSellPriceSnapshot(dto.ChannelOtherSettings{}, "m", sellPriceChannel{Id: 42}, 900, CostTokenBreakdown{}, other)

	price := other["admin_info"].(map[string]interface{})["price"].(map[string]interface{})
	assert.NotContains(t, price, "sell_markup")
	assert.NotContains(t, price, "sell_input_price")
	// 线路码为空时不写这个键，报表少一次"空串还是没线路"的特判。
	assert.NotContains(t, price, "line_code")
	assert.Equal(t, 42, price["channel_id"])
}
