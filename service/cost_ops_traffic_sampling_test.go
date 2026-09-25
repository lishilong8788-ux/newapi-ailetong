package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 运营流量（渠道测试 / playground / 运营副驾）不得进日聚合的内存桶。
//
// 这条盯的是两条路径的口径必须一致：重算路径 parseLogForCostRecalc 早就按
// model.OpsTrafficSources 排除了运营流量，而实时路径 attachUpstreamCost 曾经完全不看
// traffic_source。后果是每次重算后这部分消失、实时运行又攒回来，两个口径永远对不上；
// 副驾自己烧的 token 还会落进它自己要报的毛利分母，而且多数未定价，直接顶高
// "未定价流量占比"这个健康度指标。实测一次：2 笔副驾请求记出 102,128 收入，比整个
// 真实交易日的 17,611 还高六倍。
//
// 当时 trafficSourceOf 这个 helper 已经存在、注释也写着"供毛利统计过滤"，但全仓零
// 引用——Go 不报未使用的函数，所以编译和测试都是绿的。
func TestAttachUpstreamCost_OpsTrafficIsNotSampled(t *testing.T) {
	buildCtx := func(trafficSource string) *gin.Context {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		if trafficSource != "" {
			common.SetContextKey(ctx, constant.ContextKeyTrafficSource, trafficSource)
		}
		return ctx
	}
	relayInfo := func() *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{
				ChannelId:         7,
				UpstreamModelName: "deepseek-v4",
				ChannelOtherSettings: dto.ChannelOtherSettings{
					Cost: &dto.ChannelCostSettings{
						Models: map[string]dto.ModelCostPrice{
							"deepseek-v4": {Input: floatPtr(1.0), Output: floatPtr(2.0)},
						},
					},
				},
			},
		}
	}
	inputs := CostInputs{
		Revenue: 1200,
		Tokens:  CostTokenBreakdown{PromptTokens: 1000, CompletionTokens: 500},
	}

	for _, source := range model.OpsTrafficSources {
		t.Run("ops:"+source, func(t *testing.T) {
			costBuckets.Clear()
			t.Cleanup(func() { costBuckets.Clear() })

			other := map[string]interface{}{}
			attachUpstreamCost(buildCtx(source), relayInfo(), inputs, other)

			assert.Empty(t, drainCostBuckets(),
				"traffic_source=%s 是我们自己打的流量，不能进 channel_cost_daily", source)

			// 成本快照照写：账本要按行显示运营流量那几笔的成本。
			adminInfo, ok := other["admin_info"].(map[string]interface{})
			require.True(t, ok, "运营流量仍要有成本快照，账本按行显示要用")
			assert.NotNil(t, adminInfo["cost"])
		})
	}

	// 真实客户流量必须照采，别把闸门开成全关。
	for _, source := range []string{"", "api"} {
		t.Run("customer:"+source, func(t *testing.T) {
			costBuckets.Clear()
			t.Cleanup(func() { costBuckets.Clear() })

			attachUpstreamCost(buildCtx(source), relayInfo(), inputs, map[string]interface{}{})

			drained := drainCostBuckets()
			require.Len(t, drained, 1, "traffic_source=%q 是客户流量，必须采样", source)
			for _, b := range drained {
				assert.Equal(t, 1, b.requestCount)
				assert.Equal(t, int64(1200), b.revenueQuota)
			}
		})
	}
}
