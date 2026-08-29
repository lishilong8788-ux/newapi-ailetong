package common

import "strings"

var (
	// OpenAIResponseOnlyModels is a list of models that are only available for OpenAI responses.
	OpenAIResponseOnlyModels = []string{
		"o3-pro",
		"o3-deep-research",
		"o4-mini-deep-research",
	}
	// ImageGenerationModels drives the image-generation endpoint that
	// GetEndpointTypesByChannelType prepends. Aggregator channel types
	// (new-api, sub2api) advertise one fixed endpoint set for every model they
	// carry, so a model's own name is the only signal left that it generates
	// images rather than text — without an entry here such a model reads as
	// chat everywhere downstream.
	//
	// Entries are matched with `contains`, or as a prefix when written as
	// "prefix:". Keep them narrow enough not to catch a sibling model on a
	// different endpoint: a bare "-image" would also match Kling-3.0-image,
	// which is a task-based tencentcloud-vod-image model, and "wan" alone
	// would catch the Wan video line.
	ImageGenerationModels = []string{
		"dall-e-3",
		"dall-e-2",
		"gpt-image-1",
		"prefix:imagen-",
		"flux-",
		"flux.1-",
		"qwen-image",
		"z-image",
		"wan2.7-image",
	}
	// TaskVideoModels are served only through the async task API
	// (/v1/video/generations and the platform-specific routes in
	// router/video-router.go), never through /v1/chat/completions.
	//
	// Same aggregator problem as ImageGenerationModels, opposite conclusion:
	// there the name adds an endpoint, here it must *replace* the channel's
	// chat endpoints, because claiming a video model answers chat requests is
	// simply false and turns it into a trap wherever models are listed.
	//
	// The three tencentcloud-vod-image models (Kling-3.0-image, Qwen-0925,
	// Vidu-q2) belong here too: this repo has no task-based *image* route, so
	// they reach upstream through the video task chain.
	TaskVideoModels = []string{
		"seedance",
		"happyhorse",
		"kling-3.0",
		"kling-o1",
		"minimax-h3",
		"vidu-q",
		"qwen-0925",
	}
	// AudioTranscriptionModels consume audio and emit text (ASR). They are not
	// speech synthesis and share no client surface with it, so they resolve to
	// the transcription endpoint rather than to chat.
	AudioTranscriptionModels = []string{
		"fun-asr",
		"-asr-",
		"prefix:asr-",
	}
	OpenAITextModels = []string{
		"gpt-",
		"o1",
		"o3",
		"o4",
		"chatgpt",
	}
)

func IsOpenAIResponseOnlyModel(modelName string) bool {
	for _, m := range OpenAIResponseOnlyModels {
		if strings.Contains(modelName, m) {
			return true
		}
	}
	return false
}

// matchesModelPattern reports whether modelName matches any entry in patterns,
// using the shared convention: `contains`, or a prefix when the entry is
// written as "prefix:". Callers pass an already-lowercased name.
func matchesModelPattern(modelName string, patterns []string) bool {
	for _, p := range patterns {
		if suffix, ok := strings.CutPrefix(p, "prefix:"); ok {
			if strings.HasPrefix(modelName, suffix) {
				return true
			}
			continue
		}
		if strings.Contains(modelName, p) {
			return true
		}
	}
	return false
}

// IsTaskVideoModel reports whether a model is served only through the async
// video task API. See TaskVideoModels.
func IsTaskVideoModel(modelName string) bool {
	return matchesModelPattern(strings.ToLower(modelName), TaskVideoModels)
}

// IsAudioTranscriptionModel reports whether a model is speech-to-text (ASR).
func IsAudioTranscriptionModel(modelName string) bool {
	return matchesModelPattern(strings.ToLower(modelName), AudioTranscriptionModels)
}

func IsImageGenerationModel(modelName string) bool {
	modelName = strings.ToLower(modelName)
	for _, m := range ImageGenerationModels {
		if strings.Contains(modelName, m) {
			return true
		}
		if strings.HasPrefix(m, "prefix:") && strings.HasPrefix(modelName, strings.TrimPrefix(m, "prefix:")) {
			return true
		}
	}
	return false
}

func IsOpenAITextModel(modelName string) bool {
	modelName = strings.ToLower(modelName)
	for _, m := range OpenAITextModels {
		if strings.Contains(modelName, m) {
			return true
		}
	}
	return false
}
