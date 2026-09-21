package route_setting

import "github.com/QuantumNous/new-api/setting/config"

// RouteSetting governs how a request picks among the channels that can serve
// one model. It is deliberately separate from cost_setting: cost accounting is
// about what we paid, this is about which upstream a live request reaches, and
// the two should be switchable independently.
type RouteSetting struct {
	// AutoRouteEnabled turns on lowest-sell-price-first channel ordering.
	//
	// Default off, and the off path is byte-identical to the behaviour that
	// shipped before this setting existed: an upgrade must never silently
	// re-route production traffic. With it on, the manually maintained channel
	// priority stops deciding the order for any model whose channels have
	// distinguishable sell prices — that is the entire point of the feature, and
	// the reason it cannot default to on.
	AutoRouteEnabled bool `json:"auto_route_enabled"`
}

var routeSetting = RouteSetting{
	AutoRouteEnabled: false,
}

func init() {
	// Registered under "route_setting", so UpdateOption routes
	// "route_setting.auto_route_enabled" here through handleConfigUpdate and
	// InitOptionMap picks it up via ExportAllConfigs.
	config.GlobalConfig.Register("route_setting", &routeSetting)
}

func GetRouteSetting() *RouteSetting {
	return &routeSetting
}

// AutoRouteEnabled is the one question the request path asks, so it gets a
// direct reader rather than making every caller reach through the struct.
func AutoRouteEnabled() bool {
	return routeSetting.AutoRouteEnabled
}
