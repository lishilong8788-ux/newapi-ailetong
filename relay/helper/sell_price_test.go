package helper

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	sellPriceTestModel = "sell-price-test-model"
	sellPriceTestGroup = "sell-price-test-group"
)

func fptr(f float64) *float64 { return &f }

// sellPriceFixture 把平台倍率设成一个显眼的值（模型倍率 100、分组倍率 0.5），
// 这样"卖价生效"和"退回老计费"两种结果不可能看混。
func sellPriceFixture(t *testing.T, cost *dto.ChannelCostSettings, mapping string) (*gin.Context, *relaycommon.RelayInfo) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	savedModel := ratio_setting.ModelRatio2JSONString()
	savedGroup := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedModel))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(savedGroup))
	})
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"`+sellPriceTestModel+`":100}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"`+sellPriceTestGroup+`":0.5}`))

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	if cost != nil {
		common.SetContextKey(ctx, constant.ContextKeyChannelOtherSetting, dto.ChannelOtherSettings{Cost: cost})
	}
	if mapping != "" {
		ctx.Set("model_mapping", mapping)
	}

	info := &relaycommon.RelayInfo{
		OriginModelName: sellPriceTestModel,
		UserGroup:       sellPriceTestGroup,
		UsingGroup:      sellPriceTestGroup,
	}
	return ctx, info
}

// TestModelPriceHelper_SellPriceOverridesPlatformRatio 是这条计费路径的主断言：
// 渠道填了进价+利润率，计费就按 进价 × (1 + 利润率) 走，平台倍率和分组倍率都不
// 再参与。$20/1M 进价 + 30% 利润 = $26/1M 卖价 = 模型倍率 13。
func TestModelPriceHelper_SellPriceOverridesPlatformRatio(t *testing.T) {
	ctx, info := sellPriceFixture(t, &dto.ChannelCostSettings{
		DefaultMarkup: fptr(0.3),
		Models: map[string]dto.ModelCostPrice{
			sellPriceTestModel: {Input: fptr(20), Output: fptr(40), CacheRead: fptr(2)},
		},
	}, "")

	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)

	assert.InDelta(t, 13.0, priceData.ModelRatio, 1e-9, "卖价 $26/1M 应换算成模型倍率 13")
	assert.InDelta(t, 2.0, priceData.CompletionRatio, 1e-9, "output/input = 40/20")
	assert.InDelta(t, 0.1, priceData.CacheRatio, 1e-9, "cache_read/input = 2/20")
	assert.Equal(t, 1.0, priceData.GroupRatioInfo.GroupRatio, "卖价是绝对价，分组倍率不再参与")
}

// TestModelPriceHelper_UnconfiguredChannelKeepsLegacyBilling 锁住渐进上线的另一
// 半：没配进价的渠道-模型必须字节级走老路，否则这个特性一上线就动了全站的价。
func TestModelPriceHelper_UnconfiguredChannelKeepsLegacyBilling(t *testing.T) {
	cases := []struct {
		name string
		cost *dto.ChannelCostSettings
	}{
		{name: "no cost settings at all", cost: nil},
		{name: "cost settings with no models", cost: &dto.ChannelCostSettings{DefaultMarkup: fptr(0.3)}},
		{
			name: "another model is configured, not this one",
			cost: &dto.ChannelCostSettings{
				DefaultMarkup: fptr(0.3),
				Models:        map[string]dto.ModelCostPrice{"some-other-model": {Input: fptr(20)}},
			},
		},
		{
			name: "cost present but no markup anywhere",
			cost: &dto.ChannelCostSettings{
				Models: map[string]dto.ModelCostPrice{sellPriceTestModel: {Input: fptr(20)}},
			},
		},
		{
			name: "per-call cost cannot be expressed as a ratio",
			cost: &dto.ChannelCostSettings{
				DefaultMarkup: fptr(0.3),
				Models:        map[string]dto.ModelCostPrice{sellPriceTestModel: {PerCall: fptr(0.02)}},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, info := sellPriceFixture(t, tc.cost, "")

			priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
			require.NoError(t, err)

			assert.Equal(t, 100.0, priceData.ModelRatio, "应保留平台模型倍率")
			assert.Equal(t, 0.5, priceData.GroupRatioInfo.GroupRatio, "应保留分组倍率")
		})
	}
}

// TestModelPriceHelper_SellPriceKeyedOnUpstreamModel 进价按上游模型名索引。算价
// 跑在 ModelMappedHelper 之前，所以这里要证明它自己把映射链走对了——否则配在
// 上游名下的进价会查不到，静默退回老计费。
func TestModelPriceHelper_SellPriceKeyedOnUpstreamModel(t *testing.T) {
	ctx, info := sellPriceFixture(t, &dto.ChannelCostSettings{
		DefaultMarkup: fptr(0),
		Models: map[string]dto.ModelCostPrice{
			"upstream-real-name": {Input: fptr(20), Output: fptr(20)},
		},
	}, `{"`+sellPriceTestModel+`":"upstream-real-name"}`)

	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)

	assert.InDelta(t, 10.0, priceData.ModelRatio, 1e-9, "利润率 0 时卖价即进价 $20/1M = 倍率 10")
}

// TestModelPriceHelper_ZeroGroupRatioStaysFree 分组倍率 0 是"这个分组免费"的开关，
// 不是折扣。卖价把它改成 1 就等于开始向本来不该付费的分组收钱。
func TestModelPriceHelper_ZeroGroupRatioStaysFree(t *testing.T) {
	ctx, info := sellPriceFixture(t, &dto.ChannelCostSettings{
		DefaultMarkup: fptr(0.3),
		Models:        map[string]dto.ModelCostPrice{sellPriceTestModel: {Input: fptr(20), Output: fptr(40)}},
	}, "")
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"`+sellPriceTestGroup+`":0}`))

	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)

	assert.Equal(t, 0.0, priceData.GroupRatioInfo.GroupRatio)
	assert.Equal(t, 0, priceData.QuotaToPreConsume)
}
