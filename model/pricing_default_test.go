package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestDefaultVendorRulesAreUnambiguous guards the one invariant the rule table
// cannot express on its own: initDefaultVendorMapping breaks on the first
// match while ranging over a map, so if any model name matched two patterns the
// vendor it lands on would depend on Go's randomized map iteration order — the
// same deployment would show different vendors across restarts.
//
// Checking pattern-vs-pattern containment catches this for every possible model
// name, not just the ones a fixture happens to list: two patterns can both
// match some name only if one contains the other.
func TestDefaultVendorRulesAreUnambiguous(t *testing.T) {
	for a, vendorA := range defaultVendorRules {
		for b, vendorB := range defaultVendorRules {
			if a == b || vendorA == vendorB {
				continue
			}
			assert.False(t, strings.Contains(a, b),
				"pattern %q (%s) contains %q (%s): a model matching both gets a "+
					"vendor decided by map iteration order", a, vendorA, b, vendorB)
		}
	}
}

// TestDefaultVendorRulesMatchKnownModels pins the attributions added for an
// aggregator upstream whose model names are the only vendor signal available:
// these models carry no metadata row, so this table is what puts a vendor icon
// on their cards.
func TestDefaultVendorRulesMatchKnownModels(t *testing.T) {
	vendorFor := func(modelName string) string {
		lower := strings.ToLower(modelName)
		for pattern, vendor := range defaultVendorRules {
			if strings.Contains(lower, pattern) {
				return vendor
			}
		}
		return ""
	}

	cases := map[string]string{
		"QwQ-32B":             "阿里巴巴",
		"z-image-turbo":       "阿里巴巴",
		"wan2.7-image":        "阿里巴巴",
		"qwen-image-3.0":      "阿里巴巴",
		"fun-asr":             "阿里巴巴",
		"seedance2.0-fast":    "字节跳动",
		"Seedance 2.0":        "字节跳动",
		"Kling-3.0-image":     "快手",
		"deepseek-v4-pro":     "DeepSeek",
		"glm-5.3":             "智谱",
		"kimi-k2.6":           "Moonshot",
		"MiniMax-M2.5":        "MiniMax",
		"qwen3.6-max-preview": "阿里巴巴",
	}

	for modelName, want := range cases {
		assert.Equal(t, want, vendorFor(modelName), "model %q", modelName)
	}
}
