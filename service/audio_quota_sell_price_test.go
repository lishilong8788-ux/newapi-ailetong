package service

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	hosttypes "github.com/QuantumNous/new-api/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 音频计费从"现查平台倍率表"改成"读 PriceData"之后，这两件事必须同时成立：
// 渠道配了卖价时音频按卖价收，没配时逐字等价于改动前。后者是这批改动里风险最大
// 的一处——它动的是 realtime/wss 结算路径，而那条路径上没配卖价的渠道占绝大多数。

// TestAudioQuotaInfo_ReadsRatiosFromPriceData 钉住搬运本身。
//
// 之前三个入口各自 ratio_setting.GetAudioRatio(...)，卖价改写过的倍率读不到。
// 这里给 PriceData 填一组与平台表不可能重合的值，断言它们原样到达 QuotaInfo：
// 任何一处退回现查，这个测试就会拿到平台默认值而不是这里填的数。
func TestAudioQuotaInfo_ReadsRatiosFromPriceData(t *testing.T) {
	relayInfo := &relaycommon.RelayInfo{
		PriceData: hosttypes.PriceData{
			ModelRatio:           7.5,
			CompletionRatio:      3.25,
			AudioRatio:           16,
			AudioCompletionRatio: 2,
			ModelPrice:           0.04,
			GroupRatioInfo:       hosttypes.GroupRatioInfo{GroupRatio: 1},
		},
	}

	got := audioQuotaInfo(relayInfo, "gpt-4o-audio-preview",
		TokenDetails{TextTokens: 100, AudioTokens: 50},
		TokenDetails{TextTokens: 20, AudioTokens: 10})

	assert.Equal(t, 7.5, got.ModelRatio)
	assert.Equal(t, 3.25, got.CompletionRatio)
	assert.Equal(t, 16.0, got.AudioRatio, "audio ratio must come from PriceData, not the platform table")
	assert.Equal(t, 2.0, got.AudioCompletionRatio)
	assert.Equal(t, 0.04, got.ModelPrice)
	assert.Equal(t, 1.0, got.GroupRatio)
	assert.Equal(t, "gpt-4o-audio-preview", got.ModelName)
	assert.Equal(t, 50, got.InputDetails.AudioTokens)
	assert.Equal(t, 10, got.OutputDetails.AudioTokens)
}

// TestCalculateAudioQuota_ChargesAudioAtItsOwnRate 是漏价那条的正面断言。
//
// gpt-4o-audio 这类模型音频是文本的十几倍价。改动前平台表未命中该模型时
// GetAudioRatio 返回 1，等于按文本价卖音频；现在卖价推出的 16 倍能到账单上。
func TestCalculateAudioQuota_ChargesAudioAtItsOwnRate(t *testing.T) {
	info := QuotaInfo{
		InputDetails:  TokenDetails{TextTokens: 1000, AudioTokens: 500},
		OutputDetails: TokenDetails{TextTokens: 200, AudioTokens: 100},
		ModelName:     "gpt-4o-audio-preview",
		ModelRatio:    1,
		GroupRatio:    1,
		// 音频进价 $40/1M、文本 $2.5/1M → 16 倍；音频输出 $80 → 音频输入的 2 倍。
		CompletionRatio:      4,
		AudioRatio:           16,
		AudioCompletionRatio: 2,
	}

	quota, clamp := calculateAudioQuota(info)
	require.Nil(t, clamp)

	// 1000 + 200×4 + 500×16 + 100×16×2 = 1000 + 800 + 8000 + 3200 = 13000
	assert.Equal(t, 13000, quota)

	// 同一笔请求，音频倍率退回 1（改动前平台表未命中该模型的行为）：
	// 1000 + 800 + 500 + 100×1×2 = 2500。差 5.2 倍，就是漏掉的那部分。
	info.AudioRatio = 1
	info.AudioCompletionRatio = 2
	degraded, clamp := calculateAudioQuota(info)
	require.Nil(t, clamp)
	assert.Equal(t, 2500, degraded)
	assert.Greater(t, quota, degraded*5)
}

// TestCalculateAudioQuota_UnconfiguredChannelMatchesPlatformArithmetic 是等价性
// 那一半：没配卖价时 ModelPriceHelper 往 PriceData 里填的就是平台倍率原值，所以
// 走 PriceData 与改动前现查平台表必须算出同一个数。
//
// 这里用一组平台值手算一遍对齐，而不是 mock ratio_setting —— 要钉的是"同样的倍率
// 进去，同样的钱出来"，那是纯算术，与倍率从哪读无关。
func TestCalculateAudioQuota_UnconfiguredChannelMatchesPlatformArithmetic(t *testing.T) {
	const (
		modelRatio           = 2.5
		groupRatio           = 0.8
		completionRatio      = 3
		audioRatio           = 1 // 平台表未命中音频倍率时的默认值
		audioCompletionRatio = 1
	)

	info := QuotaInfo{
		InputDetails:         TokenDetails{TextTokens: 800, AudioTokens: 200},
		OutputDetails:        TokenDetails{TextTokens: 150, AudioTokens: 50},
		ModelName:            "some-audio-model",
		ModelRatio:           modelRatio,
		GroupRatio:           groupRatio,
		CompletionRatio:      completionRatio,
		AudioRatio:           audioRatio,
		AudioCompletionRatio: audioCompletionRatio,
	}

	quota, clamp := calculateAudioQuota(info)
	require.Nil(t, clamp)

	// (800 + 150×3 + 200×1 + 50×1×1) × 2.5 × 0.8 = 1500 × 2 = 3000
	assert.Equal(t, 3000, quota)
}

// TestCalculateAudioQuota_PerCallPriceIgnoresRatios 守住按次计价那条岔路：
// UsePrice 为真时音频倍率一个都不参与，改动不该把它们漏进按次的账里。
func TestCalculateAudioQuota_PerCallPriceIgnoresRatios(t *testing.T) {
	info := QuotaInfo{
		InputDetails:         TokenDetails{TextTokens: 1000, AudioTokens: 9999},
		OutputDetails:        TokenDetails{TextTokens: 1000, AudioTokens: 9999},
		ModelName:            "per-call-audio",
		UsePrice:             true,
		ModelPrice:           0.04,
		GroupRatio:           1,
		AudioRatio:           16,
		AudioCompletionRatio: 2,
	}

	quota, clamp := calculateAudioQuota(info)
	require.Nil(t, clamp)
	// $0.04 × QuotaPerUnit × 1，token 与倍率一概不看。
	assert.Equal(t, 20000, quota)
}
