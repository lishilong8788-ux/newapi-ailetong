package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// NormalizeModelTags is the single gate every models.tags write goes through, so
// the storage contract is asserted here directly: comma is the only separator,
// the length limit counts runes rather than bytes, and two spellings of one slug
// cannot both be stored.
func TestNormalizeModelTags(t *testing.T) {
	// 32 runes but 96 bytes: a byte-based length check would wrongly reject this.
	cjkAtLimit := strings.Repeat("测", 32)
	cjkOverLimit := strings.Repeat("测", 33)

	// Short single-letter tags, so the count limit is reached before the joined
	// column-length limit.
	shortTags := make([]string, 0, MaxTagsPerModel+1)
	for i := 0; i < MaxTagsPerModel+1; i++ {
		shortTags = append(shortTags, string(rune('a'+i)))
	}
	atCountLimit := strings.Join(shortTags[:MaxTagsPerModel], ",")

	testCases := []struct {
		name      string
		raw       string
		want      string
		wantError bool
	}{
		{name: "empty stays empty", raw: "", want: ""},
		{name: "whitespace only stays empty", raw: "   ", want: ""},
		{name: "trims elements and drops empties", raw: " a , , b ", want: "a,b"},
		{name: "keeps operator spelling", raw: "Hot,Long Context", want: "Hot,Long Context"},
		{name: "rejects semicolon inside element", raw: "a;b", wantError: true},
		{name: "rejects pipe inside element", raw: "a|b", wantError: true},
		{name: "rejects semicolon after comma split", raw: "ok,a;b", wantError: true},
		{name: "accepts CJK tag at rune limit", raw: cjkAtLimit, want: cjkAtLimit},
		{name: "rejects CJK tag over rune limit", raw: cjkOverLimit, wantError: true},
		{name: "rejects case-only collision", raw: "Hot,hot", wantError: true},
		{name: "rejects separator-only collision", raw: "long context,long-context", wantError: true},
		{name: "rejects tag with no slug", raw: "a,-", wantError: true},
		{name: "accepts the maximum tag count", raw: atCountLimit, want: atCountLimit},
		{name: "rejects one tag past the maximum", raw: strings.Join(shortTags, ","), wantError: true},
		// 12 tags of 32 runes each overflow varchar(255), which MySQL outside
		// strict mode would truncate silently instead of rejecting.
		{
			name:      "rejects a joined value longer than the column",
			raw:       strings.Repeat(cjkAtLimit+",", MaxTagsPerModel-1) + cjkAtLimit,
			wantError: true,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := NormalizeModelTags(testCase.raw)
			if testCase.wantError {
				require.Error(t, err)
				assert.Empty(t, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, testCase.want, got)
		})
	}
}

// MergeModelTags is the read-modify-write half of the batch endpoint. Matching
// removals on the normalized slug is what makes a legacy "Hot" removable by
// asking for "hot", and re-validating the merged result is what stops a batch
// from pushing a row past the per-model limit.
func TestMergeModelTags(t *testing.T) {
	atCountLimit := make([]string, 0, MaxTagsPerModel)
	for i := 0; i < MaxTagsPerModel; i++ {
		atCountLimit = append(atCountLimit, string(rune('a'+i)))
	}

	testCases := []struct {
		name       string
		current    string
		addTags    []string
		removeTags []string
		want       string
		wantError  bool
	}{
		{name: "adds to an empty value", current: "", addTags: []string{"hot"}, want: "hot"},
		{name: "appends after existing tags", current: "fast", addTags: []string{"hot"}, want: "fast,hot"},
		{
			name:    "keeps stored spelling when the slug already exists",
			current: "Hot,fast",
			addTags: []string{"hot"},
			want:    "Hot,fast",
		},
		{
			name:    "treats separator variants as one tag",
			current: "long context",
			addTags: []string{"long-context"},
			want:    "long context",
		},
		{
			name:       "removes a legacy spelling by slug",
			current:    "Hot,fast",
			removeTags: []string{"hot"},
			want:       "fast",
		},
		{
			name:       "removing the last tag yields an empty value",
			current:    "hot",
			removeTags: []string{"HOT"},
			want:       "",
		},
		{
			// Removals are applied first, so a slug in both lists ends up present
			// with the requested spelling — a documented contract, not an accident.
			name:       "an add re-applies a slug that was also removed",
			current:    "hot,fast",
			addTags:    []string{"Hot"},
			removeTags: []string{"hot"},
			want:       "fast,Hot",
		},
		{
			name:    "collapses a pre-existing slug duplicate",
			current: "Hot,hot,fast",
			addTags: []string{"new"},
			want:    "Hot,fast,new",
		},
		{
			name:      "refuses to push a full row past the limit",
			current:   strings.Join(atCountLimit, ","),
			addTags:   []string{"overflow"},
			wantError: true,
		},
		{
			name:      "reports a row holding a legacy separator",
			current:   "a;b",
			addTags:   []string{"hot"},
			wantError: true,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := MergeModelTags(testCase.current, testCase.addTags, testCase.removeTags)
			if testCase.wantError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, testCase.want, got)
		})
	}
}

// SyncExcludeFields is an exclusion mask so that 0 — every pre-existing row —
// keeps syncing every field with no data migration. That zero-value contract and
// the one-bit-per-field isolation are what controller/model_sync.go relies on
// when it decides whether to take an upstream value, so both are asserted here:
// a shifted or duplicated bit would silently protect the wrong column.
func TestModelSyncExcludeMask(t *testing.T) {
	allFields := []int{SyncExcludeDescription, SyncExcludeIcon, SyncExcludeTags, SyncExcludeVendor}

	zeroMask := Model{}
	for _, field := range allFields {
		assert.False(t, zeroMask.SyncExcludes(field), "zero mask must exclude nothing")
	}

	for _, excluded := range allFields {
		single := Model{SyncExcludeFields: excluded}
		for _, field := range allFields {
			assert.Equal(t, excluded == field, single.SyncExcludes(field),
				"bit %d must exclude only itself, checked against %d", excluded, field)
		}
	}

	everything := Model{SyncExcludeFields: syncExcludeAllFields}
	for _, field := range allFields {
		assert.True(t, everything.SyncExcludes(field))
	}

	require.NoError(t, ValidateSyncExcludeFields(0))
	require.NoError(t, ValidateSyncExcludeFields(syncExcludeAllFields))
	// A client sending -1 or an undefined high bit must not park garbage in the
	// column, since a future bit would then already read as excluded.
	require.Error(t, ValidateSyncExcludeFields(-1))
	require.Error(t, ValidateSyncExcludeFields(syncExcludeAllFields+1))
}

// BatchApplyModelTags must report per model rather than failing the whole call,
// and must actually persist an emptied tag list — an Updates() on a struct would
// drop "" as a zero value and the last tag could never be removed.
func TestBatchApplyModelTags(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Model{}))
	require.NoError(t, DB.Exec("DELETE FROM models").Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Exec("DELETE FROM models").Error)
	})

	fullTags := make([]string, 0, MaxTagsPerModel)
	for i := 0; i < MaxTagsPerModel; i++ {
		fullTags = append(fullTags, string(rune('a'+i)))
	}
	rows := []*Model{
		{ModelName: "gets-tag", Tags: "fast"},
		{ModelName: "already-tagged", Tags: "Hot"},
		{ModelName: "at-tag-limit", Tags: strings.Join(fullTags, ",")},
		{ModelName: "loses-only-tag", Tags: "hot"},
	}
	for _, row := range rows {
		require.NoError(t, row.Insert())
	}
	byName := func(name string) Model {
		var stored Model
		require.NoError(t, DB.Where("model_name = ?", name).First(&stored).Error)
		return stored
	}

	missingId := rows[len(rows)-1].Id + 1000
	ids := []int{rows[0].Id, rows[1].Id, rows[2].Id, missingId}
	result, err := BatchApplyModelTags(ids, []string{"hot"}, nil)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Updated)
	assert.Equal(t, 1, result.Skipped)
	require.Len(t, result.Failures, 2)
	assert.Equal(t, rows[2].Id, result.Failures[0].Id)
	assert.Equal(t, "at-tag-limit", result.Failures[0].ModelName)
	assert.Equal(t, missingId, result.Failures[1].Id)
	assert.Equal(t, "模型不存在", result.Failures[1].Message)

	assert.Equal(t, "fast,hot", byName("gets-tag").Tags)
	// Already present by slug: the stored spelling is untouched.
	assert.Equal(t, "Hot", byName("already-tagged").Tags)
	assert.Equal(t, strings.Join(fullTags, ","), byName("at-tag-limit").Tags)

	// Removing the only tag must persist as an empty column value.
	removed, err := BatchApplyModelTags([]int{rows[3].Id}, nil, []string{"HOT"})
	require.NoError(t, err)
	assert.Equal(t, 1, removed.Updated)
	assert.Empty(t, removed.Failures)
	assert.Equal(t, "", byName("loses-only-tag").Tags)

	// Request-level rejections happen before any row is touched.
	_, err = BatchApplyModelTags([]int{rows[0].Id}, nil, nil)
	require.Error(t, err)
	_, err = BatchApplyModelTags([]int{rows[0].Id}, []string{"a;b"}, nil)
	require.Error(t, err)
	_, err = BatchApplyModelTags(nil, []string{"hot"}, nil)
	require.Error(t, err)
	assert.Equal(t, "fast,hot", byName("gets-tag").Tags)
}
