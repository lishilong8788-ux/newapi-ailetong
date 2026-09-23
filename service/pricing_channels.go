package service

import (
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/setting/route_setting"
)

// AutoRouteInfo describes the routing policy in force for a model, for the
// catalog's auto-route card.
type AutoRouteInfo struct {
	Enabled bool `json:"enabled"`
	// Mode names the policy so the UI can badge it without hardcoding a string
	// per switch. "lowest_price" is the only implemented one; "manual" means the
	// operator's channel priority still decides.
	Mode string `json:"mode"`
	// Ranked reports whether THIS model's channels actually have a price spread
	// the router can order on. Enabled && !Ranked is a real and common state —
	// no channel has a discount configured yet — and the UI must not promise
	// price-first routing there.
	Ranked bool `json:"ranked"`
}

const (
	AutoRouteModeLowestPrice = "lowest_price"
	AutoRouteModeManual      = "manual"
)

// GetModelChannelRoutes lists the channels serving one model, cheapest first,
// restricted to groups the caller can actually reach.
//
// usableGroups is the caller's own reachable set (service.GetUserUsableGroups),
// so an anonymous visitor sees the public groups and nothing else. Passing the
// full group list here would leak the existence of private lines.
func GetModelChannelRoutes(modelName string, usableGroups map[string]string) []*model.ChannelRoute {
	if modelName == "" || len(usableGroups) == 0 {
		return nil
	}
	groups := make([]string, 0, len(usableGroups))
	for group := range usableGroups {
		groups = append(groups, group)
	}
	routes := model.GetModelChannelRoutes(modelName, groups)
	attachChannelHealth(modelName, routes)
	return routes
}

// channelHealthCacheTTL keeps /api/pricing/channels a cheap endpoint. Route
// resolution itself is served from an in-memory cache, and this is a public
// endpoint an unauthenticated visitor can poll, so a per-request aggregate over
// a week of buckets is not something to hand the database. 60s also matches the
// frontend query's staleTime, so a reader refreshing the drawer sees the same
// numbers the card showed.
const channelHealthCacheTTL = 60 * time.Second

type channelHealthCacheItem struct {
	health    map[int]perfmetrics.ChannelHealth
	expiresAt time.Time
}

// groupHealth is the model+group aggregate a channel with no traffic of its own
// borrows from — the same measurement the group cards on the same screen show.
type groupHealth struct {
	successRate float64
	ttftMs      int64
}

type groupAvailabilityCacheItem struct {
	rates     map[string]groupHealth
	expiresAt time.Time
}

var (
	channelHealthMu    sync.Mutex
	channelHealthCache = map[string]channelHealthCacheItem{}

	groupAvailabilityMu    sync.Mutex
	groupAvailabilityCache = map[string]groupAvailabilityCacheItem{}
)

// attachChannelHealth fills in measured availability and first-token time.
//
// Best effort by design: a failed metrics query leaves the fields nil and the
// card renders "no data", which is a far better outcome than failing a price
// list because a statistics table is unavailable.
func attachChannelHealth(modelName string, routes []*model.ChannelRoute) {
	if len(routes) == 0 {
		return
	}

	health, ok := cachedChannelHealth(modelName)
	if !ok {
		queried, err := perfmetrics.QueryChannelHealth(modelName, perfmetrics.ChannelHealthWindowHours)
		if err != nil {
			common.SysError("failed to query channel health for " + modelName + ": " + err.Error())
			return
		}
		health = queried
		storeChannelHealth(modelName, health)
	}

	// The group aggregate is the fallback for channels with no traffic of their
	// own. It is the same measurement the group cards on the same screen already
	// show, so borrowing it makes the two rows agree instead of one claiming "no
	// data" beside the other's full bars.
	groupRates := groupAvailability(modelName)

	for _, route := range routes {
		if entry, found := health[route.ChannelID]; found {
			route.AvailabilityPct = entry.AvailabilityPct
			route.TtftMs = entry.TtftMs
			if entry.AvailabilityPct != nil {
				route.AvailabilitySource = model.AvailabilitySourceChannel
			}
			if entry.TtftMs > 0 {
				route.TtftSource = model.AvailabilitySourceChannel
			}
		}

		if len(groupRates) == 0 {
			continue
		}
		fallback, found := bestGroupRate(groupRates, route.Groups)
		if !found {
			continue
		}

		// Independent fallbacks: a channel that has served only non-streaming
		// requests has a real availability figure and no first-token time at all,
		// so one field can be its own measurement while the other is borrowed.
		if route.AvailabilityPct == nil {
			rate := fallback.successRate
			route.AvailabilityPct = &rate
			route.AvailabilitySource = model.AvailabilitySourceGroup
		}
		if route.TtftMs == 0 && fallback.ttftMs > 0 {
			route.TtftMs = fallback.ttftMs
			route.TtftSource = model.AvailabilitySourceGroup
		}
	}
}

// bestGroupRate picks the availability of the group the reader is most likely to
// be quoted on. A channel commonly serves one model in several groups, and those
// groups can have very different histories, so the lowest rate is used: it is the
// one claim that stays true whichever group the request ends up in.
func bestGroupRate(rates map[string]groupHealth, groups []string) (groupHealth, bool) {
	worst, found := groupHealth{}, false
	for _, group := range groups {
		rate, ok := rates[group]
		if !ok {
			continue
		}
		if !found || rate.successRate < worst.successRate {
			worst, found = rate, true
		}
	}
	return worst, found
}

// groupAvailability returns success rate per group for one model, over the same
// window the channel figures use so the two are comparable.
//
// Cached alongside the channel health it backs up, and best effort for the same
// reason: a price list must not fail because a statistics table is briefly
// unavailable.
func groupAvailability(modelName string) map[string]groupHealth {
	if rates, ok := cachedGroupAvailability(modelName); ok {
		return rates
	}

	result, err := perfmetrics.Query(perfmetrics.QueryParams{
		Model: modelName,
		Hours: perfmetrics.ChannelHealthWindowHours,
	})
	if err != nil {
		common.SysError("failed to query group availability for " + modelName + ": " + err.Error())
		return nil
	}

	rates := make(map[string]groupHealth, len(result.Groups))
	for _, group := range result.Groups {
		rates[group.Group] = groupHealth{
			successRate: group.SuccessRate,
			ttftMs:      group.AvgTtftMs,
		}
	}
	storeGroupAvailability(modelName, rates)
	return rates
}

func cachedGroupAvailability(modelName string) (map[string]groupHealth, bool) {
	groupAvailabilityMu.Lock()
	defer groupAvailabilityMu.Unlock()
	item, ok := groupAvailabilityCache[modelName]
	if !ok || time.Now().After(item.expiresAt) {
		return nil, false
	}
	return item.rates, true
}

func storeGroupAvailability(modelName string, rates map[string]groupHealth) {
	groupAvailabilityMu.Lock()
	defer groupAvailabilityMu.Unlock()
	groupAvailabilityCache[modelName] = groupAvailabilityCacheItem{
		rates:     rates,
		expiresAt: time.Now().Add(channelHealthCacheTTL),
	}
}

func cachedChannelHealth(modelName string) (map[int]perfmetrics.ChannelHealth, bool) {
	channelHealthMu.Lock()
	defer channelHealthMu.Unlock()
	item, ok := channelHealthCache[modelName]
	if !ok || time.Now().After(item.expiresAt) {
		return nil, false
	}
	return item.health, true
}

func storeChannelHealth(modelName string, health map[int]perfmetrics.ChannelHealth) {
	channelHealthMu.Lock()
	defer channelHealthMu.Unlock()
	channelHealthCache[modelName] = channelHealthCacheItem{
		health:    health,
		expiresAt: time.Now().Add(channelHealthCacheTTL),
	}
}

// GetModelAutoRouteInfo reports the routing policy for one model.
//
// routes must be the list GetModelChannelRoutes returned for the same model:
// "ranked" is derived from the prices in that list rather than re-read from the
// cache, so the card and the rows below it can never disagree.
func GetModelAutoRouteInfo(routes []*model.ChannelRoute) AutoRouteInfo {
	info := AutoRouteInfo{
		Enabled: route_setting.AutoRouteEnabled(),
		Mode:    AutoRouteModeManual,
	}
	if info.Enabled {
		info.Mode = AutoRouteModeLowestPrice
	}

	// Two distinct tiers is the same test buildChannelPriceRanks applies, for the
	// same reason: with one tier there is no cheapest channel to prefer.
	unpriced := false
	var seen []float64
	for _, route := range routes {
		if route.Price.Discount == nil || route.Price.ModelRatio <= 0 {
			unpriced = true
			continue
		}
		duplicate := false
		for _, ratio := range seen {
			if diff := ratio - route.Price.ModelRatio; diff < 1e-9 && diff > -1e-9 {
				duplicate = true
				break
			}
		}
		if !duplicate {
			seen = append(seen, route.Price.ModelRatio)
		}
	}
	tiers := len(seen)
	if unpriced {
		tiers++
	}
	info.Ranked = tiers >= 2
	return info
}
