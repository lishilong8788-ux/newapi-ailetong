package pricing_setting

import "github.com/QuantumNous/new-api/setting/config"

// PricingSetting holds presentation-layer configuration for the public model
// catalog. It deliberately carries no prices: everything here is display
// metadata an operator should be able to change without a release.
type PricingSetting struct {
	// TagRegistry is a JSON array of TagDefinition governing the colour,
	// category and per-language display name of the operational tags stored in
	// the `models.tags` column.
	//
	// It holds operator overrides and additions only — the frontend ships the
	// built-in vocabulary (hot / reasoning / deprecated / ...) compiled in and
	// layers this on top. Keeping the defaults out of the backend means a
	// catalog page paints correct colours before /api/status resolves, and the
	// default set never has to be kept in sync across two languages.
	//
	// Empty is the normal state for an installation that never opened the
	// editor, and renders exactly as it did before this setting existed.
	TagRegistry string `json:"tag_registry"`
}

var pricingSetting = PricingSetting{}

func init() {
	// Registered under "pricing_setting", so UpdateOption routes
	// "pricing_setting.tag_registry" here through handleConfigUpdate and
	// InitOptionMap picks it up via ExportAllConfigs.
	config.GlobalConfig.Register("pricing_setting", &pricingSetting)
}

func GetPricingSetting() *PricingSetting {
	return &pricingSetting
}
