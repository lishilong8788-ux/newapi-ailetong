package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// knownLineCodes is the set of line codes any enabled channel publishes, rebuilt
// on every channel cache sync.
//
// Needed because `<model>/<code>` is ambiguous on its face: "qwen/qwen3" is a
// vendor-namespaced model name, not model "qwen" on line "qwen3". Splitting on
// the slash alone would reroute every namespaced model to nowhere. A suffix is
// only read as a line when some channel actually publishes that code, so an
// install with no line codes configured parses model names exactly as before.
var knownLineCodes map[string]bool

// RefreshKnownLineCodes rebuilds the published line-code set from the database.
//
// Deliberately independent of MemoryCacheEnabled: the set is what makes a
// `<model>/<code>` suffix parse as a pin at all, so gating it on the cache switch
// turned line pinning into a silent no-op whenever the cache was off — the suffix
// stayed glued to the model name, matched no registered model, and surfaced as an
// unrelated "no available channel" 503. Routing correctness must not depend on a
// performance switch.
//
// Only enabled channels publish a code, matching the pinned-line filter: a
// disabled channel's line must not make a pin parse and then resolve to a channel
// that cannot serve it.
func RefreshKnownLineCodes() {
	var codes []string
	err := DB.Model(&Channel{}).
		Where("status = ? and line_code is not null and line_code != ''", common.ChannelStatusEnabled).
		Distinct().
		Pluck("line_code", &codes).Error
	if err != nil {
		common.SysError("failed to refresh known line codes: " + err.Error())
		return
	}

	newCodes := make(map[string]bool, len(codes))
	for _, code := range codes {
		if trimmed := strings.TrimSpace(code); trimmed != "" {
			newCodes[trimmed] = true
		}
	}

	channelSyncLock.Lock()
	knownLineCodes = newCodes
	channelSyncLock.Unlock()
}

// SplitModelLineCode splits a client-supplied model name into the bare model and
// the line code it pins, reporting whether a line was named at all.
//
// The suffix must be a code some enabled channel publishes, and the full name
// must not itself be a registered model — an operator who put the literal
// "deepseek-v4/hs10" in a channel's model list means that name, and silently
// reinterpreting it as a pin would break a working setup. Both guards fail
// closed: the name passes through untouched and routing behaves as it did.
func SplitModelLineCode(group string, modelName string) (string, string, bool) {
	idx := strings.LastIndex(modelName, "/")
	if idx <= 0 || idx == len(modelName)-1 {
		return modelName, "", false
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	suffix := modelName[idx+1:]
	if !knownLineCodes[suffix] {
		return modelName, "", false
	}
	// A registered literal wins over the pin reading.
	if group != "" {
		if _, registered := group2model2channels[group][modelName]; registered {
			return modelName, "", false
		}
	} else {
		for _, model2channels := range group2model2channels {
			if _, registered := model2channels[modelName]; registered {
				return modelName, "", false
			}
		}
	}

	return modelName[:idx], suffix, true
}

// filterChannelsByLineCode keeps only candidates published under lineCode.
//
// Returns the input untouched when lineCode is empty (the unpinned path pays
// nothing) and nil when the line names no usable channel, which the caller reads
// as "pin missed" and handles by falling back to the full candidate list. The
// pin is a preference, not a constraint: a customer who names a line still wants
// an answer when that line is down, and the response headers report which
// channel actually served so the pin's outcome stays visible.
func filterChannelsByLineCode(channelIDs []int, lineCode string) []int {
	if lineCode == "" || len(channelIDs) == 0 {
		return channelIDs
	}
	filtered := make([]int, 0, len(channelIDs))
	for _, id := range channelIDs {
		channel, ok := channelsIDM[id]
		if !ok {
			continue
		}
		if channel.GetLineCode() == lineCode {
			filtered = append(filtered, id)
		}
	}
	if len(filtered) == 0 {
		return nil
	}
	return filtered
}
