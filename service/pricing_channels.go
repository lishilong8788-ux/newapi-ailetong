package service

import (
	"github.com/QuantumNous/new-api/model"
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
	return model.GetModelChannelRoutes(modelName, groups)
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
