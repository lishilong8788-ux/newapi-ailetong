package pricing_setting

import (
	"fmt"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

// Limits on the registry. It rides on /api/status, which every page load
// fetches, so the payload is capped rather than left to grow unbounded.
const (
	MaxTagRegistryEntries = 64
	MaxTagSlugLength      = 32
	MaxTagLabelLength     = 32
	MaxTagAliases         = 8
	MaxTagLanguages       = 16
)

// TagKind is what a tag asserts about a model, which decides how the catalog
// treats it beyond colour: promo tags lead the card and animate, capability
// tags are plain facts, lifecycle tags describe availability.
type TagKind string

const (
	TagKindPromo      TagKind = "promo"
	TagKindCapability TagKind = "capability"
	TagKindLifecycle  TagKind = "lifecycle"
)

var validTagKinds = map[TagKind]bool{
	TagKindPromo:      true,
	TagKindCapability: true,
	TagKindLifecycle:  true,
}

// TagDefinition is one entry of the registry.
type TagDefinition struct {
	// Slug is the canonical identifier, matched against a normalized tag from
	// the models.tags column (lowercased, whitespace collapsed to "-").
	Slug string `json:"slug"`
	// Color is a semantic colour name the badge component can render.
	Color string `json:"color"`
	// Kind drives ordering and emphasis. Empty means capability.
	Kind TagKind `json:"kind,omitempty"`
	// Labels maps a language code ("en", "zh", "zh-TW", ...) to the display
	// name. A language absent here falls back to "en", then to the slug.
	Labels map[string]string `json:"labels,omitempty"`
	// Aliases are extra spellings that resolve to this slug, so an operator who
	// typed "热门" and one who typed "hot" get the same badge.
	Aliases []string `json:"aliases,omitempty"`
}

// validTagColors is the set of colours the badge component actually renders.
//
// Deliberately NOT console_setting.validColors: that list allows "slate", which
// has no entry in the frontend's dotColorMap and would render a badge with no
// colour class at all. These 21 are the keys that map to a real class.
var validTagColors = map[string]bool{
	"success": true, "warning": true, "danger": true, "info": true,
	"neutral": true, "purple": true, "amber": true, "blue": true,
	"cyan": true, "green": true, "grey": true, "indigo": true,
	"light-blue": true, "light-green": true, "lime": true, "orange": true,
	"pink": true, "red": true, "teal": true, "violet": true, "yellow": true,
}

// IsValidTagColor reports whether a colour name renders as a badge.
func IsValidTagColor(color string) bool {
	return validTagColors[color]
}

// NormalizeTagSlug is the single canonical form of a tag, shared by the
// registry, the model editor and the catalog's own lookup.
//
// Lowercasing plus whitespace-to-hyphen is what lets the pre-existing
// "long context" rows resolve against the "long-context" registry entry with no
// data migration: both normalize to the same slug.
func NormalizeTagSlug(tag string) string {
	trimmed := strings.TrimSpace(tag)
	if trimmed == "" {
		return ""
	}
	lowered := strings.ToLower(trimmed)
	var b strings.Builder
	b.Grow(len(lowered))
	// A literal "-" counts as a hyphen too, so "a - b" collapses to "a-b"
	// exactly as the TypeScript normalizeTagSlug does with its trailing
	// `replace(/-+/g, '-')` pass.
	prevHyphen := false
	for _, r := range lowered {
		if unicode.IsSpace(r) || r == '_' || r == '-' {
			if !prevHyphen && b.Len() > 0 {
				b.WriteByte('-')
				prevHyphen = true
			}
			continue
		}
		b.WriteRune(r)
		prevHyphen = false
	}
	// Trimmed on both ends so this agrees exactly with the TypeScript
	// normalizeTagSlug, which strips leading and trailing hyphens.
	return strings.Trim(b.String(), "-")
}

// ValidateTagRegistry checks the JSON an admin submitted. Called from
// model.validateOptionValue, so every write path — single option update, bulk
// update, direct model.UpdateOption — is covered, not just the HTTP handler.
func ValidateTagRegistry(value string) error {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return nil
	}

	var defs []TagDefinition
	if err := common.UnmarshalJsonStr(raw, &defs); err != nil {
		return fmt.Errorf("标签注册表格式错误：%s", err.Error())
	}
	if len(defs) > MaxTagRegistryEntries {
		return fmt.Errorf("标签注册表最多 %d 条，当前 %d 条", MaxTagRegistryEntries, len(defs))
	}

	seen := make(map[string]int, len(defs))
	for i, def := range defs {
		position := i + 1

		slug := NormalizeTagSlug(def.Slug)
		if slug == "" {
			return fmt.Errorf("第%d条标签的 slug 不能为空", position)
		}
		if utf8.RuneCountInString(slug) > MaxTagSlugLength {
			return fmt.Errorf("第%d条标签的 slug 长度不能超过 %d 字符", position, MaxTagSlugLength)
		}
		if strings.ContainsAny(slug, ",;|") {
			return fmt.Errorf("第%d条标签的 slug 不能包含分隔符 , ; |", position)
		}
		if prev, dup := seen[slug]; dup {
			return fmt.Errorf("第%d条标签的 slug 与第%d条重复：%s", position, prev, slug)
		}
		seen[slug] = position

		if !validTagColors[def.Color] {
			return fmt.Errorf("第%d条标签的颜色值不合法：%s", position, def.Color)
		}
		if def.Kind != "" && !validTagKinds[def.Kind] {
			return fmt.Errorf("第%d条标签的类别不合法：%s", position, def.Kind)
		}

		if len(def.Labels) > MaxTagLanguages {
			return fmt.Errorf("第%d条标签的语言数不能超过 %d", position, MaxTagLanguages)
		}
		for lang, label := range def.Labels {
			if strings.TrimSpace(lang) == "" {
				return fmt.Errorf("第%d条标签存在空的语言代码", position)
			}
			if utf8.RuneCountInString(label) > MaxTagLabelLength {
				return fmt.Errorf("第%d条标签的 %s 显示名长度不能超过 %d 字符", position, lang, MaxTagLabelLength)
			}
		}

		if len(def.Aliases) > MaxTagAliases {
			return fmt.Errorf("第%d条标签的别名不能超过 %d 个", position, MaxTagAliases)
		}
		for _, alias := range def.Aliases {
			normalized := NormalizeTagSlug(alias)
			if normalized == "" {
				return fmt.Errorf("第%d条标签存在空别名", position)
			}
			if utf8.RuneCountInString(normalized) > MaxTagSlugLength {
				return fmt.Errorf("第%d条标签的别名 %s 长度不能超过 %d 字符", position, alias, MaxTagSlugLength)
			}
		}
	}

	// Second pass: an alias that also names another entry's slug (or another
	// entry's alias) would make resolution order-dependent, so it is rejected
	// rather than silently resolved by whichever entry is scanned first.
	aliasOwner := make(map[string]int)
	for i, def := range defs {
		position := i + 1
		for _, alias := range def.Aliases {
			normalized := NormalizeTagSlug(alias)
			if owner, taken := seen[normalized]; taken && owner != position {
				return fmt.Errorf("第%d条标签的别名 %s 与第%d条的 slug 冲突", position, alias, owner)
			}
			if owner, taken := aliasOwner[normalized]; taken && owner != position {
				return fmt.Errorf("第%d条标签的别名 %s 与第%d条的别名重复", position, alias, owner)
			}
			aliasOwner[normalized] = position
		}
	}
	return nil
}

// Parsed registry cache. Keyed on the raw string so a config write invalidates
// it implicitly — no explicit invalidation hook to forget to call.
var (
	tagRegistryMu     sync.RWMutex
	tagRegistryRaw    string
	tagRegistryParsed []TagDefinition
)

// GetTagRegistry returns the operator-configured tag definitions, normalized.
// Never nil, so callers can range over it directly. An unparseable value yields
// an empty registry, which degrades to the frontend's built-in vocabulary.
func GetTagRegistry() []TagDefinition {
	raw := strings.TrimSpace(pricingSetting.TagRegistry)

	tagRegistryMu.RLock()
	if raw == tagRegistryRaw {
		cached := tagRegistryParsed
		tagRegistryMu.RUnlock()
		return cached
	}
	tagRegistryMu.RUnlock()

	parsed := make([]TagDefinition, 0)
	if raw != "" {
		var defs []TagDefinition
		if err := common.UnmarshalJsonStr(raw, &defs); err == nil {
			for _, def := range defs {
				def.Slug = NormalizeTagSlug(def.Slug)
				if def.Slug == "" || !validTagColors[def.Color] {
					continue
				}
				if def.Kind != "" && !validTagKinds[def.Kind] {
					def.Kind = ""
				}
				normalizedAliases := make([]string, 0, len(def.Aliases))
				for _, alias := range def.Aliases {
					if normalized := NormalizeTagSlug(alias); normalized != "" {
						normalizedAliases = append(normalizedAliases, normalized)
					}
				}
				def.Aliases = normalizedAliases
				parsed = append(parsed, def)
			}
		}
	}

	tagRegistryMu.Lock()
	tagRegistryRaw = raw
	tagRegistryParsed = parsed
	tagRegistryMu.Unlock()
	return parsed
}
