package pricing_setting

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setTagRegistry writes the raw option value the way model.updateOptionMap
// eventually does, and restores it so tests stay order-independent.
func setTagRegistry(t *testing.T, raw string) {
	t.Helper()
	original := GetPricingSetting().TagRegistry
	t.Cleanup(func() {
		GetPricingSetting().TagRegistry = original
	})
	GetPricingSetting().TagRegistry = raw
}

// tagRegistryJSON marshals definitions into the stored option value, so
// oversized fixtures are generated instead of hand-written.
func tagRegistryJSON(t *testing.T, defs []TagDefinition) string {
	t.Helper()
	encoded, err := common.Marshal(defs)
	require.NoError(t, err)
	return string(encoded)
}

// The expectations here are the contract shared with the TypeScript
// normalizeTagSlug in web/src/lib/model-tags.ts: a tag typed in the model
// editor is matched against the registry on the frontend and validated for
// duplicates on the backend, so the two must agree character for character.
func TestNormalizeTagSlug(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "lowercases", in: "Hot", want: "hot"},
		{name: "space becomes hyphen", in: "long context", want: "long-context"},
		{name: "trims and collapses runs", in: "  Long  Context ", want: "long-context"},
		{name: "hyphen counts as separator", in: "a - b", want: "a-b"},
		{name: "underscore becomes hyphen", in: "snake_case", want: "snake-case"},
		{name: "strips edge hyphens", in: "-lead-", want: "lead"},
		{name: "empty stays empty", in: "", want: ""},
		{name: "whitespace only is empty", in: "   ", want: ""},
		{name: "CJK preserved verbatim", in: "多模态", want: "多模态"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, NormalizeTagSlug(tt.in))
		})
	}
}

func TestValidateTagRegistryAccepts(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{name: "unset", value: ""},
		{name: "whitespace only", value: "   \n\t "},
		{name: "empty array", value: `[]`},
		{
			name: "multi entry with labels aliases and kinds",
			value: `[
				{"slug":"hot","color":"red","kind":"promo","labels":{"en":"Hot","zh":"热门"},"aliases":["热门","popular"]},
				{"slug":"long context","color":"blue","kind":"capability","labels":{"en":"Long context"}},
				{"slug":"deprecated","color":"danger","kind":"lifecycle"}
			]`,
		},
		{
			name:  "alias equal to own slug is not a self conflict",
			value: `[{"slug":"hot","color":"red","aliases":["Hot"]}]`,
		},
		{
			name:  "kind may be omitted",
			value: `[{"slug":"vision","color":"cyan"}]`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.NoError(t, ValidateTagRegistry(tt.value))
		})
	}
}

func TestValidateTagRegistryRejects(t *testing.T) {
	tooManyEntries := make([]TagDefinition, 0, MaxTagRegistryEntries+1)
	for i := 0; i <= MaxTagRegistryEntries; i++ {
		tooManyEntries = append(tooManyEntries, TagDefinition{
			Slug:  fmt.Sprintf("tag-%d", i),
			Color: "blue",
		})
	}
	tooManyAliases := make([]string, 0, MaxTagAliases+1)
	for i := 0; i <= MaxTagAliases; i++ {
		tooManyAliases = append(tooManyAliases, fmt.Sprintf("alias-%d", i))
	}

	tests := []struct {
		name  string
		value string
		// wantMessage is a fragment identifying which rule fired, so a case
		// cannot pass by tripping a different check than it targets.
		wantMessage string
	}{
		{
			name:        "malformed JSON",
			value:       `[{"slug":"hot","color":"red"`,
			wantMessage: "格式错误",
		},
		{
			name:        "empty slug",
			value:       `[{"slug":"","color":"red"}]`,
			wantMessage: "slug 不能为空",
		},
		{
			name:        "slug that normalizes to empty",
			value:       `[{"slug":"  -  ","color":"red"}]`,
			wantMessage: "slug 不能为空",
		},
		{
			name:        "duplicate slugs after normalization",
			value:       `[{"slug":"Hot","color":"red"},{"slug":"hot","color":"blue"}]`,
			wantMessage: "slug 与第1条重复",
		},
		{
			name:        "slug contains comma",
			value:       `[{"slug":"hot,new","color":"red"}]`,
			wantMessage: "不能包含分隔符",
		},
		{
			name:        "slug contains semicolon",
			value:       `[{"slug":"hot;new","color":"red"}]`,
			wantMessage: "不能包含分隔符",
		},
		{
			name:        "slug contains pipe",
			value:       `[{"slug":"hot|new","color":"red"}]`,
			wantMessage: "不能包含分隔符",
		},
		{
			// "slate" is in console_setting's validColors but has no key in the
			// frontend dotColorMap, so it would render a badge with no colour.
			name:        "colour valid for console but unrenderable as a tag",
			value:       `[{"slug":"hot","color":"slate"}]`,
			wantMessage: "颜色值不合法",
		},
		{
			name:        "empty colour",
			value:       `[{"slug":"hot","color":""}]`,
			wantMessage: "颜色值不合法",
		},
		{
			name:        "invalid kind",
			value:       `[{"slug":"hot","color":"red","kind":"banner"}]`,
			wantMessage: "类别不合法",
		},
		{
			name:        "over entry limit",
			value:       tagRegistryJSON(t, tooManyEntries),
			wantMessage: fmt.Sprintf("最多 %d 条", MaxTagRegistryEntries),
		},
		{
			name: "slug over length limit",
			value: tagRegistryJSON(t, []TagDefinition{
				{Slug: strings.Repeat("a", MaxTagSlugLength+1), Color: "red"},
			}),
			wantMessage: fmt.Sprintf("slug 长度不能超过 %d", MaxTagSlugLength),
		},
		{
			name: "label over length limit",
			value: tagRegistryJSON(t, []TagDefinition{
				{Slug: "hot", Color: "red", Labels: map[string]string{
					"en": strings.Repeat("a", MaxTagLabelLength+1),
				}},
			}),
			wantMessage: fmt.Sprintf("显示名长度不能超过 %d", MaxTagLabelLength),
		},
		{
			name: "too many aliases",
			value: tagRegistryJSON(t, []TagDefinition{
				{Slug: "hot", Color: "red", Aliases: tooManyAliases},
			}),
			wantMessage: fmt.Sprintf("别名不能超过 %d 个", MaxTagAliases),
		},
		{
			name:        "alias collides with another entry's slug",
			value:       `[{"slug":"hot","color":"red"},{"slug":"new","color":"blue","aliases":["Hot"]}]`,
			wantMessage: "与第1条的 slug 冲突",
		},
		{
			name:        "alias duplicated across two entries",
			value:       `[{"slug":"hot","color":"red","aliases":["trending"]},{"slug":"new","color":"blue","aliases":["Trending"]}]`,
			wantMessage: "与第1条的别名重复",
		},
		{
			name:        "empty alias",
			value:       `[{"slug":"hot","color":"red","aliases":["   "]}]`,
			wantMessage: "存在空别名",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTagRegistry(tt.value)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantMessage)
		})
	}
}

// GetTagRegistry reads whatever is already persisted, which may predate a
// validation rule, so it repairs or drops per entry instead of failing whole.
func TestGetTagRegistryNormalizesAndDropsUnusableEntries(t *testing.T) {
	setTagRegistry(t, `[
		{"slug":"  Long  Context ","color":"blue","kind":"capability","aliases":["Long Context","长文本","  "]},
		{"slug":"broken","color":"slate","kind":"promo"},
		{"slug":"   ","color":"red"},
		{"slug":"Hot","color":"red","kind":"banner","labels":{"en":"Hot"}}
	]`)

	got := GetTagRegistry()
	require.Len(t, got, 2, "invalid colour and empty slug entries must be dropped")

	assert.Equal(t, "long-context", got[0].Slug)
	assert.Equal(t, "blue", got[0].Color)
	assert.Equal(t, TagKindCapability, got[0].Kind)
	assert.Equal(t, []string{"long-context", "长文本"}, got[0].Aliases)

	assert.Equal(t, "hot", got[1].Slug)
	assert.Equal(t, "red", got[1].Color)
	assert.Equal(t, TagKind(""), got[1].Kind, "unknown kind is blanked, not a reason to drop the entry")
	assert.Equal(t, map[string]string{"en": "Hot"}, got[1].Labels)
}

// Never nil, because /api/status marshals the result and the frontend layers
// its built-in vocabulary over an array — `null` would be a type error there.
func TestGetTagRegistryReturnsEmptyNotNilForUnusableValues(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{name: "unset", value: ""},
		{name: "whitespace only", value: "  \n "},
		{name: "not JSON at all", value: "not json"},
		{name: "JSON object instead of array", value: `{"slug":"hot"}`},
		{name: "empty array", value: `[]`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setTagRegistry(t, tt.value)
			got := GetTagRegistry()
			require.NotNil(t, got)
			assert.Empty(t, got)
		})
	}
}

// The parsed registry is cached keyed on the raw option string. An admin saving
// a new registry updates only that string, so a stale cache would keep serving
// the previous colours until restart.
func TestGetTagRegistryCacheInvalidatesWhenValueChanges(t *testing.T) {
	setTagRegistry(t, `[{"slug":"hot","color":"red","kind":"promo"}]`)
	first := GetTagRegistry()
	require.Len(t, first, 1)
	assert.Equal(t, "red", first[0].Color)

	GetPricingSetting().TagRegistry = `[{"slug":"hot","color":"blue"},{"slug":"new","color":"green"}]`
	second := GetTagRegistry()
	require.Len(t, second, 2)
	assert.Equal(t, "blue", second[0].Color)
	assert.Equal(t, "new", second[1].Slug)

	GetPricingSetting().TagRegistry = ""
	assert.Empty(t, GetTagRegistry())
}

// Whitespace differences in the stored value are not a semantic change, and the
// cache is keyed on the trimmed string, so re-reading is stable.
func TestGetTagRegistryRepeatedReadsAreStable(t *testing.T) {
	setTagRegistry(t, `[{"slug":"hot","color":"red"}]`)
	first := GetTagRegistry()
	GetPricingSetting().TagRegistry = "  " + GetPricingSetting().TagRegistry + "  "
	assert.Equal(t, first, GetTagRegistry())
}
