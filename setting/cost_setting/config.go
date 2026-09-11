package cost_setting

import "github.com/QuantumNous/new-api/setting/config"

// CostSetting governs upstream cost accounting and margin reporting.
// Both switches default off: an upgrade must never start changing channel
// routing or reporting until the operator explicitly opts in. Cost
// accounting (Enabled) and automatic margin actions (GuardEnabled) are
// separate so the books can run for a while before any automation is
// trusted with channel state.
type CostSetting struct {
	Enabled     bool `json:"enabled"`
	GuardEnabled bool `json:"guard_enabled"`

	// OfficialPriceSource picks where fallback official prices come from:
	// "models_dev" (synced upstream catalog) or "manual".
	OfficialPriceSource string `json:"official_price_source"`
	// DefaultDiscount is the global fallback multiplier applied to official
	// prices when a channel has no explicit discount (1.0 = list price).
	DefaultDiscount float64 `json:"default_discount"`

	// Margin response thresholds, chained:
	// DisableRate <= DemoteRate <= AlertRate <= WarnRate, each in [0,1].
	WarnRate    float64 `json:"warn_rate"`
	AlertRate   float64 `json:"alert_rate"`
	DemoteRate  float64 `json:"demote_rate"`
	DisableRate float64 `json:"disable_rate"`
	// DemotePriorityDelta is how far a channel's priority is lowered on L3.
	DemotePriorityDelta int `json:"demote_priority_delta"`

	// Guard trigger gates. WindowMinutes is the sliding evaluation window.
	WindowMinutes       int   `json:"window_minutes"`
	MinRequests         int   `json:"min_requests"`
	MinRevenueQuota     int64 `json:"min_revenue_quota"`
	MaxUnknownRate      float64 `json:"max_unknown_rate"`
	CooldownMinutes     int   `json:"cooldown_minutes"`
	AutoRecoverHours    int   `json:"auto_recover_hours"`
	ProtectLastChannel  bool  `json:"protect_last_channel"`

	// FlushIntervalSeconds controls the ChannelCostDaily aggregation flush.
	FlushIntervalSeconds int `json:"flush_interval_seconds"`

	// ProtectChannels / ProtectModels are operator-curated exemption
	// lists (traffic-attracting models and strategic channels may be
	// low-margin by design).
	ProtectChannels string `json:"protect_channels"`
	ProtectModels   string `json:"protect_models"`
}

var costSetting = CostSetting{
	Enabled:     false,
	GuardEnabled: false,

	OfficialPriceSource: "models_dev",
	DefaultDiscount:     1.0,

	WarnRate:    0.20,
	AlertRate:   0.10,
	DemoteRate:  0.05,
	DisableRate: 0.00,

	DemotePriorityDelta: 10,

	WindowMinutes:       60,
	MinRequests:         100,
	MinRevenueQuota:     500000,
	MaxUnknownRate:      0.05,
	CooldownMinutes:     30,
	AutoRecoverHours:    0,
	ProtectLastChannel:  true,

	FlushIntervalSeconds: 60,

	ProtectChannels: "",
	ProtectModels:   "",
}

func init() {
	config.GlobalConfig.Register("cost_setting", &costSetting)
}

func GetSetting() CostSetting {
	return costSetting
}

// GetFlushIntervalSeconds clamps the aggregation flush cadence.
func GetFlushIntervalSeconds() int {
	if costSetting.FlushIntervalSeconds < 5 {
		return 5
	}
	return costSetting.FlushIntervalSeconds
}

// SetEnabledForTest flips the accounting switch in tests. The setting var is
// package-private on purpose (config registration owns it); tests need to
// exercise both the on and off paths of the accounting chain.
func SetEnabledForTest(enabled bool) {
	costSetting.Enabled = enabled
}
