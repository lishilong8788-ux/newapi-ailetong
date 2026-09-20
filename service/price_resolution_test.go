package service

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
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
	writeSellPriceSnapshot(&dto.ChannelPriceSettings{Discount: ptr(0.44)}, "m", 1200, CostTokenBreakdown{}, other)

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
	writeSellPriceSnapshot(&dto.ChannelPriceSettings{Discount: ptr(0.5)}, "m", 1000, CostTokenBreakdown{}, other)

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
	writeSellPriceSnapshot(nil, "m", 900, CostTokenBreakdown{}, other)

	price := other["admin_info"].(map[string]interface{})["price"].(map[string]interface{})
	if _, present := price["discount"]; present {
		t.Error("fallback recorded a discount it never applied")
	}
	if price["price_source"] != PriceSourceFallback {
		t.Errorf("source = %v, want fallback", price["price_source"])
	}

	listed := map[string]interface{}{}
	writeSellPriceSnapshot(&dto.ChannelPriceSettings{Discount: ptr(1.0)}, "m", 900, CostTokenBreakdown{}, listed)
	lp := listed["admin_info"].(map[string]interface{})["price"].(map[string]interface{})
	if lp["discount"] != 1.0 {
		t.Errorf("10折 not recorded as 1.0: %v", lp["discount"])
	}
}

func TestWriteSellPriceSnapshot_NilOtherDoesNotPanic(t *testing.T) {
	writeSellPriceSnapshot(&dto.ChannelPriceSettings{Discount: ptr(0.44)}, "m", 100, CostTokenBreakdown{}, nil)
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
