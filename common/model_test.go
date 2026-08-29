package common

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"

	"github.com/stretchr/testify/assert"
)

// TestIsImageGenerationModelBoundaries pins the classification boundary that
// decides a model's modality. Aggregator channels (new-api, sub2api) advertise
// one fixed endpoint set for every model, so this name match is the only thing
// that separates an image model from a chat model on such a channel — a false
// positive routes a chat request to /v1/images/generations, a false negative
// hides an image model behind a chat canvas.
func TestIsImageGenerationModelBoundaries(t *testing.T) {
	cases := []struct {
		model string
		want  bool
	}{
		{"dall-e-3", true},
		{"gpt-image-1", true},
		{"imagen-3.0-generate-002", true},
		{"flux-1.1-pro", true},
		{"qwen-image-2.0", true},
		{"qwen-image-3.0-pro", true},
		{"z-image-turbo", true},
		{"wan2.7-image", true},
		{"QWEN-IMAGE-3.0", true}, // matching is case-insensitive

		// Sibling models that must NOT match: Kling-3.0-image is a task-based
		// tencentcloud-vod-image model, and the Wan video line shares the
		// "wan" prefix with wan2.7-image.
		{"Kling-3.0-image", false},
		{"wan2.7-t2v", false},
		{"qwen3.6-max-preview", false},
		{"gpt-4o", false},
		{"seedance2.0-fast", false},
	}

	for _, c := range cases {
		assert.Equal(t, c.want, IsImageGenerationModel(c.model), "model %q", c.model)
	}
}

// TestModalityClassifiersAreMutuallyExclusive guards the precondition of
// GetEndpointTypesByChannelType's early returns: it checks video before ASR
// before image, so a model matching two classifiers would silently take the
// first branch. Every name below must land in exactly one bucket.
func TestModalityClassifiersAreMutuallyExclusive(t *testing.T) {
	// The 74 models this deployment actually serves, plus the built-in ones.
	names := []string{
		"dall-e-3", "gpt-image-1", "imagen-3.0-generate-002", "flux-1.1-pro",
		"qwen-image-2.0", "qwen-image-3.0", "qwen-image-3.0-pro", "wan2.7-image",
		"z-image-turbo", "Seedance 2.0", "Seedance 2.0-chaofen", "seedance2.0-fast",
		"seedance2.0-huoshan", "seedance2.0-mini", "seedance2.5", "seedance2.5-chaofen",
		"seedance2.5-huoshan", "seedance2.0-kuanshen", "seedance2.0-fast-kuanshen",
		"seedance2.0-mini-kuanshen", "happyhorse-1.0-t2v", "happyhorse-1.0-i2v",
		"happyhorse-1.0-r2v", "happyhorse-1.0-video-edit", "happyhorse-1.1-t2v",
		"happyhorse-1.1-i2v", "happyhorse-1.1-r2v", "Kling-3.0", "Kling-3.0-Omni",
		"Kling-O1", "Kling-3.0-image", "Qwen-0925", "Vidu-q2", "MiniMax-H3",
		"fun-asr", "fun-asr-flash-2026-06-15", "qwen-audio-3.0-asr-flash",
		"qwen-audio-3.0-asr-flash-filetrans", "gpt-4o", "qwen3.6-max-preview",
		"glm-5.3", "deepseek-v4-pro", "kimi-k2.6", "QwQ-32B", "MiniMax-M2.5",
	}

	for _, name := range names {
		hits := 0
		for _, matched := range []bool{
			IsTaskVideoModel(name),
			IsAudioTranscriptionModel(name),
			IsImageGenerationModel(name),
		} {
			if matched {
				hits++
			}
		}
		assert.LessOrEqual(t, hits, 1,
			"model %q matches more than one modality classifier; the early "+
				"returns in GetEndpointTypesByChannelType would pick by order", name)
	}
}

// TestTaskVideoAndASRModelsDropChatEndpoints pins the contract that matters for
// any client listing models: a task-video or ASR model must NOT advertise chat.
// Returning chat here is what put 29 video/audio models in the playground's
// chat tab, where every one of them fails on send.
func TestTaskVideoAndASRModelsDropChatEndpoints(t *testing.T) {
	video := []string{"seedance2.0-fast", "Seedance 2.0", "happyhorse-1.1-t2v",
		"Kling-O1", "Kling-3.0-image", "Vidu-q2", "Qwen-0925", "MiniMax-H3"}
	for _, m := range video {
		got := GetEndpointTypesByChannelType(constant.ChannelTypeNewAPI, m)
		assert.Equal(t, []constant.EndpointType{constant.EndpointTypeOpenAIVideo}, got,
			"model %q", m)
	}

	asr := []string{"fun-asr", "qwen-audio-3.0-asr-flash",
		"qwen-audio-3.0-asr-flash-filetrans"}
	for _, m := range asr {
		got := GetEndpointTypesByChannelType(constant.ChannelTypeNewAPI, m)
		assert.Equal(t, []constant.EndpointType{constant.EndpointTypeAudioTranscription}, got,
			"model %q", m)
	}

	// A chat model on the same channel keeps the full set — the early returns
	// must not leak into the normal path.
	chat := GetEndpointTypesByChannelType(constant.ChannelTypeNewAPI, "qwen3.6-max-preview")
	assert.Contains(t, chat, constant.EndpointTypeOpenAI)
	assert.Contains(t, chat, constant.EndpointTypeAnthropic)
	assert.NotContains(t, chat, constant.EndpointTypeOpenAIVideo)
}

// TestGetEndpointTypesByChannelTypeImageGeneration guards the contract that an
// image model on an aggregator channel gains the image-generation endpoint as
// the *first* entry (the first endpoint is the preferred relay target) while
// keeping the channel's own endpoints, and that a chat model on the same
// channel never gains it.
func TestGetEndpointTypesByChannelTypeImageGeneration(t *testing.T) {
	imageEndpoints := GetEndpointTypesByChannelType(constant.ChannelTypeNewAPI, "qwen-image-3.0")
	assert.Equal(t, constant.EndpointTypeImageGeneration, imageEndpoints[0])
	assert.Contains(t, imageEndpoints, constant.EndpointTypeOpenAI)

	chatEndpoints := GetEndpointTypesByChannelType(constant.ChannelTypeNewAPI, "qwen3.6-max-preview")
	assert.NotContains(t, chatEndpoints, constant.EndpointTypeImageGeneration)
	assert.Equal(t, constant.EndpointTypeOpenAI, chatEndpoints[0])
}
