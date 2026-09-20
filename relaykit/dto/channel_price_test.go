package dto

import (
	"math"
	"strings"
	"testing"
)

func f(v float64) *float64 { return &v }

func TestChannelPriceSettings_Validate_Accepts(t *testing.T) {
	ok := []*ChannelPriceSettings{
		nil,
		{},
		{Discount: f(0.44)},
		{Discount: f(1.0)},             // 10折 = 官网原价
		{Discount: f(MinSellDiscount)}, // 下限闭区间
		{Models: map[string]*float64{"m": f(0.3)}},         // 只配逐模型
		{Discount: f(0.44), Models: map[string]*float64{}}, // 空 map 合法
	}
	for i, p := range ok {
		if err := p.Validate(); err != nil {
			t.Errorf("case %d rejected: %v", i, err)
		}
	}
}

func TestChannelPriceSettings_Validate_Rejects(t *testing.T) {
	cases := map[string]*ChannelPriceSettings{
		"zero channel":     {Discount: f(0)},
		"negative channel": {Discount: f(-0.2)},
		"above list":       {Discount: f(1.01)},
		"NaN channel":      {Discount: f(math.NaN())},
		"Inf channel":      {Discount: f(math.Inf(1))},
		"below floor":      {Discount: f(0.0001)},
		"zero model":       {Models: map[string]*float64{"m": f(0)}},
		"null model":       {Models: map[string]*float64{"m": nil}},
		"NaN model":        {Models: map[string]*float64{"m": f(math.NaN())}},
	}
	for name, p := range cases {
		t.Run(name, func(t *testing.T) {
			err := p.Validate()
			if err == nil {
				t.Fatal("accepted a misbilling discount")
			}
			if strings.TrimSpace(err.Error()) == "" {
				t.Error("error message is empty; operator cannot act on it")
			}
		})
	}
}

// The message must name the offending model, otherwise an operator with 200
// per-model overrides cannot find the bad one.
func TestChannelPriceSettings_Validate_NamesTheModel(t *testing.T) {
	p := &ChannelPriceSettings{Models: map[string]*float64{"deepseek-v4-flash": f(0)}}
	err := p.Validate()
	if err == nil {
		t.Fatal("expected rejection")
	}
	if !strings.Contains(err.Error(), "deepseek-v4-flash") {
		t.Errorf("message does not name the model: %v", err)
	}
}
