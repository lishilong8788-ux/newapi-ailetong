package model

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/pricing_setting"

	"gorm.io/gorm"
)

const (
	NameRuleExact = iota
	NameRulePrefix
	NameRuleContains
	NameRuleSuffix
)

// MaxTagsPerModel caps how many tags one model may carry. Mirrored on the
// frontend as TAG_LIMITS.maxTagsPerModel: the catalog card renders 3 and the
// detail panel renders all of them, so a row with dozens of tags is an
// operator mistake rather than a use case.
const MaxTagsPerModel = 12

// maxTagsColumnLength bounds the joined tags string. models.tags is
// varchar(255); MySQL outside strict mode truncates a longer value silently
// instead of erroring, which would corrupt the last tag. 12 tags of 32 runes
// plus separators can exceed 255, so the joined length is checked explicitly.
const maxTagsColumnLength = 255

// Bits of Model.SyncExcludeFields — fields the upstream sync must leave alone.
const (
	SyncExcludeDescription = 1 << iota
	SyncExcludeIcon
	SyncExcludeTags
	SyncExcludeVendor
)

// syncExcludeAllFields is every defined bit, used to reject masks carrying bits
// with no meaning (a typo or a client sending -1).
const syncExcludeAllFields = SyncExcludeDescription | SyncExcludeIcon | SyncExcludeTags | SyncExcludeVendor

type BoundChannel struct {
	Name string `json:"name"`
	Type int    `json:"type"`
}

type Model struct {
	Id           int    `json:"id"`
	ModelName    string `json:"model_name" gorm:"size:128;not null;uniqueIndex:uk_model_name_delete_at,priority:1"`
	Description  string `json:"description,omitempty" gorm:"type:text"`
	Icon         string `json:"icon,omitempty" gorm:"type:varchar(128)"`
	Tags         string `json:"tags,omitempty" gorm:"type:varchar(255)"`
	VendorID     int    `json:"vendor_id,omitempty" gorm:"index"`
	Endpoints    string `json:"endpoints,omitempty" gorm:"type:text"`
	Status       int    `json:"status" gorm:"default:1"`
	SyncOfficial int    `json:"sync_official" gorm:"default:1"`
	// SyncExcludeFields is a bitmask of fields EXCLUDED from the upstream sync
	// (SyncExcludeDescription | SyncExcludeIcon | ...). It is an exclusion mask
	// rather than an inclusion mask precisely so that 0 — "exclude nothing" — is
	// the correct value for every pre-existing row: the column can be added with
	// no data migration and no GORM `default:` tag, which also keeps AutoMigrate
	// from re-issuing ALTER TABLE on every restart the way boolean/int defaults
	// do across MySQL and PostgreSQL.
	//
	// SyncOfficial stays as-is and still means "skip this model entirely"; this
	// mask is the finer knob, so operator-typed tags can be protected without
	// giving up description/icon/vendor sync.
	SyncExcludeFields int            `json:"sync_exclude_fields"`
	CreatedTime       int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime       int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt         gorm.DeletedAt `json:"-" gorm:"index;uniqueIndex:uk_model_name_delete_at,priority:2"`

	BoundChannels []BoundChannel `json:"bound_channels,omitempty" gorm:"-"`
	EnableGroups  []string       `json:"enable_groups,omitempty" gorm:"-"`
	QuotaTypes    []int          `json:"quota_types,omitempty" gorm:"-"`
	NameRule      int            `json:"name_rule" gorm:"default:0"`

	MatchedModels []string `json:"matched_models,omitempty" gorm:"-"`
	MatchedCount  int      `json:"matched_count,omitempty" gorm:"-"`
}

// SyncExcludes reports whether the upstream sync must leave the given field
// alone. field is one of the SyncExclude* bits. A zero mask excludes nothing,
// so an untouched row keeps the historical behaviour of syncing every field.
func (mi *Model) SyncExcludes(field int) bool {
	return mi.SyncExcludeFields&field != 0
}

// ValidateSyncExcludeFields rejects a mask carrying bits that mean nothing, so a
// client cannot park arbitrary integers (or -1) in the column.
func ValidateSyncExcludeFields(mask int) error {
	if mask&^syncExcludeAllFields != 0 {
		return fmt.Errorf("同步排除字段取值不合法：%d", mask)
	}
	return nil
}

// Insert deliberately leaves SyncExcludeFields out of the post-Create Updates
// call below. That dance exists only because `status` and `sync_official` carry
// GORM `default:1` tags: GORM omits a zero-valued field from the INSERT when the
// field has a default, so the DB writes 1 and the caller's explicit 0 is lost.
// SyncExcludeFields has no default tag, so its zero value is written directly by
// the INSERT and needs no repair pass.
func (mi *Model) Insert() error {
	now := common.GetTimestamp()
	mi.CreatedTime = now
	mi.UpdatedTime = now

	// 保存原始值（因为 Create 后可能被 GORM 的 default 标签覆盖为 1）
	originalStatus := mi.Status
	originalSyncOfficial := mi.SyncOfficial

	// 先创建记录（GORM 会对零值字段应用默认值）
	if err := DB.Create(mi).Error; err != nil {
		return err
	}

	// 使用保存的原始值进行更新，确保零值能正确保存
	return DB.Model(&Model{}).Where("id = ?", mi.Id).Updates(map[string]interface{}{
		"status":        originalStatus,
		"sync_official": originalSyncOfficial,
	}).Error
}

func IsModelNameDuplicated(id int, name string) (bool, error) {
	if name == "" {
		return false, nil
	}
	var cnt int64
	err := DB.Model(&Model{}).Where("model_name = ? AND id <> ?", name, id).Count(&cnt).Error
	return cnt > 0, err
}

func (mi *Model) Update() error {
	mi.UpdatedTime = common.GetTimestamp()
	// 使用 Select 强制更新所有字段，包括零值
	return DB.Model(&Model{}).Where("id = ?", mi.Id).
		Select("model_name", "description", "icon", "tags", "vendor_id", "endpoints", "status", "sync_official", "sync_exclude_fields", "name_rule", "updated_time").
		Updates(mi).Error
}

func (mi *Model) Delete() error {
	return DB.Delete(mi).Error
}

func GetVendorModelCounts() (map[int64]int64, error) {
	var stats []struct {
		VendorID int64
		Count    int64
	}
	if err := DB.Model(&Model{}).
		Select("vendor_id as vendor_id, count(*) as count").
		Group("vendor_id").
		Scan(&stats).Error; err != nil {
		return nil, err
	}
	m := make(map[int64]int64, len(stats))
	for _, s := range stats {
		m[s.VendorID] = s.Count
	}
	return m, nil
}

func GetAllModels(offset int, limit int) ([]*Model, error) {
	models, _, err := SearchModels("", "", "", "", offset, limit)
	return models, err
}

func GetBoundChannelsByModelsMap(modelNames []string) (map[string][]BoundChannel, error) {
	result := make(map[string][]BoundChannel)
	if len(modelNames) == 0 {
		return result, nil
	}
	type row struct {
		Model string
		Name  string
		Type  int
	}
	var rows []row
	err := DB.Table("channels").
		Select("abilities.model as model, channels.name as name, channels.type as type").
		Joins("JOIN abilities ON abilities.channel_id = channels.id").
		Where("abilities.model IN ? AND abilities.enabled = ?", modelNames, true).
		Distinct().
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		result[r.Model] = append(result[r.Model], BoundChannel{Name: r.Name, Type: r.Type})
	}
	return result, nil
}

func normalizeLookupValues(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized
}

func GetPreferredModelOwnerChannelTypes(modelNames []string, groups []string) (map[string]int, error) {
	result := make(map[string]int)
	modelNames = normalizeLookupValues(modelNames)
	if len(modelNames) == 0 {
		return result, nil
	}

	type row struct {
		Model       string
		ChannelType int
	}
	var rows []row

	query := DB.Table("abilities").
		Select("abilities.model as model, channels.type as channel_type").
		Joins("JOIN channels ON abilities.channel_id = channels.id").
		Where("abilities.model IN ? AND abilities.enabled = ? AND channels.status = ?", modelNames, true, common.ChannelStatusEnabled).
		Order("COALESCE(abilities.priority, 0) DESC").
		Order("abilities.weight DESC").
		Order("abilities.channel_id ASC")

	groups = normalizeLookupValues(groups)
	if len(groups) > 0 {
		query = query.Where("abilities."+commonGroupCol+" IN ?", groups)
	}

	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}

	for _, r := range rows {
		if _, ok := result[r.Model]; ok {
			continue
		}
		result[r.Model] = r.ChannelType
	}
	return result, nil
}

func SearchModels(keyword string, vendor string, status string, syncOfficial string, offset int, limit int) ([]*Model, int64, error) {
	var models []*Model
	db := DB.Model(&Model{})
	if keyword != "" {
		like := "%" + keyword + "%"
		db = db.Where("model_name LIKE ? OR description LIKE ? OR tags LIKE ?", like, like, like)
	}
	if vendor != "" {
		if vid, err := strconv.Atoi(vendor); err == nil {
			db = db.Where("models.vendor_id = ?", vid)
		} else {
			db = db.Joins("JOIN vendors ON vendors.id = models.vendor_id").Where("vendors.name LIKE ?", "%"+vendor+"%")
		}
	}
	if statusValue, ok := parseModelStatusFilter(status); ok {
		db = db.Where("models.status = ?", statusValue)
	}
	if syncValue, ok := parseModelSyncFilter(syncOfficial); ok {
		db = db.Where("models.sync_official = ?", syncValue)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := db.Order("models.id DESC").Offset(offset).Limit(limit).Find(&models).Error; err != nil {
		return nil, 0, err
	}
	return models, total, nil
}

// parseModelStatusFilter maps UI/API status values to the models.status column.
// Returns ok=false when no status filter should be applied.
func parseModelStatusFilter(status string) (value int, ok bool) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "all":
		return 0, false
	case "enabled", "1":
		return 1, true
	case "disabled", "0":
		return 0, true
	default:
		n, err := strconv.Atoi(status)
		if err != nil {
			return 0, false
		}
		return n, true
	}
}

// NormalizeModelTags validates an operator-submitted models.tags value and
// returns the canonical form to store: comma-separated, each element trimmed,
// empties dropped.
//
// Comma is the only separator. `;` and `|` are rejected rather than treated as
// separators — the old public catalog split on them too, which meant a tag typed
// with a semicolon silently became two tags in the catalog and one tag in the
// editor. Rejecting is the loud, non-destructive half of that fix.
//
// Every write path must go through here (single create/update and the batch tag
// endpoint alike), because the frontend editor's checks are only a convenience
// and the API is reachable directly.
func NormalizeModelTags(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}

	kept := make([]string, 0, MaxTagsPerModel)
	slugOwner := make(map[string]string, MaxTagsPerModel)
	for _, element := range strings.Split(raw, ",") {
		tag := strings.TrimSpace(element)
		if tag == "" {
			continue
		}
		if strings.ContainsAny(tag, ";|") {
			return "", fmt.Errorf("标签「%s」不能包含分隔符 ; 或 |，多个标签请用英文逗号分隔", tag)
		}
		// Runes, not bytes: tags are routinely CJK, where a 12-character tag is
		// already 36 bytes.
		if utf8.RuneCountInString(tag) > pricing_setting.MaxTagSlugLength {
			return "", fmt.Errorf("标签「%s」长度不能超过 %d 个字符", tag, pricing_setting.MaxTagSlugLength)
		}
		slug := pricing_setting.NormalizeTagSlug(tag)
		if slug == "" {
			return "", fmt.Errorf("标签「%s」不是有效标签", tag)
		}
		if previous, duplicated := slugOwner[slug]; duplicated {
			return "", fmt.Errorf("标签「%s」与「%s」重复", tag, previous)
		}
		slugOwner[slug] = tag
		kept = append(kept, tag)
	}

	if len(kept) > MaxTagsPerModel {
		return "", fmt.Errorf("单个模型最多 %d 个标签，当前 %d 个", MaxTagsPerModel, len(kept))
	}

	normalized := strings.Join(kept, ",")
	if utf8.RuneCountInString(normalized) > maxTagsColumnLength {
		return "", fmt.Errorf("标签总长度不能超过 %d 个字符", maxTagsColumnLength)
	}
	return normalized, nil
}

// MergeModelTags applies one batch tag edit to a model's stored tags and returns
// the canonical value to write.
//
// Removals match on normalized slug, so removing "hot" also drops a legacy
// "Hot". Additions are appended only when no existing tag shares their slug, and
// the result goes through NormalizeModelTags so a batch cannot push a row past
// MaxTagsPerModel or store an over-long tag.
//
// Removals run before additions, so a slug present in both lists ends up on the
// model with the spelling from addTags. Callers that consider that contradictory
// should reject it before calling.
//
// Pre-existing rows that already hold two spellings of one slug are repaired
// here (first spelling wins) instead of failing the whole batch — no information
// is lost by collapsing them. A stored `;`/`|` is NOT repaired, because splitting
// it would be a guess; NormalizeModelTags rejects that row and the failure is
// reported per model.
func MergeModelTags(current string, addTags []string, removeTags []string) (string, error) {
	removeSlugs := make(map[string]struct{}, len(removeTags))
	for _, tag := range removeTags {
		if slug := pricing_setting.NormalizeTagSlug(tag); slug != "" {
			removeSlugs[slug] = struct{}{}
		}
	}

	kept := make([]string, 0, MaxTagsPerModel)
	keptSlugs := make(map[string]struct{}, MaxTagsPerModel)
	for _, element := range strings.Split(current, ",") {
		tag := strings.TrimSpace(element)
		if tag == "" {
			continue
		}
		slug := pricing_setting.NormalizeTagSlug(tag)
		if slug == "" {
			continue
		}
		if _, removed := removeSlugs[slug]; removed {
			continue
		}
		if _, duplicated := keptSlugs[slug]; duplicated {
			continue
		}
		keptSlugs[slug] = struct{}{}
		kept = append(kept, tag)
	}

	for _, tag := range addTags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		slug := pricing_setting.NormalizeTagSlug(tag)
		if slug == "" {
			continue
		}
		if _, present := keptSlugs[slug]; present {
			continue
		}
		keptSlugs[slug] = struct{}{}
		kept = append(kept, tag)
	}

	return NormalizeModelTags(strings.Join(kept, ","))
}

// ModelTagBatchFailure is one model the batch could not apply, kept per model so
// a single bad row (legacy `;` in its tags, or already at MaxTagsPerModel) does
// not hide the rest of the outcome.
type ModelTagBatchFailure struct {
	Id        int    `json:"id"`
	ModelName string `json:"model_name"`
	Message   string `json:"message"`
}

// ModelTagBatchResult is the outcome of one batch tag edit. Skipped counts rows
// that were found but needed no write (every add already present, every removal
// absent).
type ModelTagBatchResult struct {
	Updated  int                    `json:"updated"`
	Skipped  int                    `json:"skipped"`
	Failures []ModelTagBatchFailure `json:"failures"`
}

// BatchApplyModelTags adds and removes tags on many models in one transaction.
//
// Tags need read-modify-write, so the browser cannot do this by firing N
// concurrent full-row updates: those race and the last writer wins with a stale
// tag list. One transaction with the rows locked up front is the fix.
//
// A per-model validation failure is recorded and the batch continues — rolling
// back rows that merged cleanly because one row is over its tag limit would be
// surprising. Only a real DB error aborts and rolls back the whole batch.
func BatchApplyModelTags(ids []int, addTags []string, removeTags []string) (ModelTagBatchResult, error) {
	result := ModelTagBatchResult{Failures: make([]ModelTagBatchFailure, 0)}

	uniqueIds := make([]int, 0, len(ids))
	seenIds := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, duplicated := seenIds[id]; duplicated {
			continue
		}
		seenIds[id] = struct{}{}
		uniqueIds = append(uniqueIds, id)
	}
	if len(uniqueIds) == 0 {
		return result, fmt.Errorf("请至少选择一个模型")
	}

	// Validate the requested additions once, against the whole request, so a bad
	// tag fails the call outright instead of producing the same error N times.
	if _, err := NormalizeModelTags(strings.Join(addTags, ",")); err != nil {
		return result, err
	}
	hasAdd := false
	for _, tag := range addTags {
		if pricing_setting.NormalizeTagSlug(tag) != "" {
			hasAdd = true
			break
		}
	}
	hasRemove := false
	for _, tag := range removeTags {
		if pricing_setting.NormalizeTagSlug(tag) != "" {
			hasRemove = true
			break
		}
	}
	if !hasAdd && !hasRemove {
		return result, fmt.Errorf("请至少指定一个要添加或移除的标签")
	}

	now := common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		var rows []Model
		// Ordered by id so two concurrent batches with overlapping selections
		// take the row locks in the same sequence and cannot deadlock.
		if err := lockForUpdate(tx).Where("id IN ?", uniqueIds).Order("id ASC").Find(&rows).Error; err != nil {
			return err
		}

		found := make(map[int]struct{}, len(rows))
		for i := range rows {
			row := &rows[i]
			found[row.Id] = struct{}{}

			merged, mergeErr := MergeModelTags(row.Tags, addTags, removeTags)
			if mergeErr != nil {
				result.Failures = append(result.Failures, ModelTagBatchFailure{
					Id:        row.Id,
					ModelName: row.ModelName,
					Message:   mergeErr.Error(),
				})
				continue
			}
			if merged == row.Tags {
				result.Skipped++
				continue
			}
			// A map keeps an empty result persistent: Updates on a struct would
			// drop "" as a zero value and the last tag could never be removed.
			if err := tx.Model(&Model{}).Where("id = ?", row.Id).Updates(map[string]interface{}{
				"tags":         merged,
				"updated_time": now,
			}).Error; err != nil {
				return err
			}
			result.Updated++
		}

		for _, id := range uniqueIds {
			if _, ok := found[id]; !ok {
				result.Failures = append(result.Failures, ModelTagBatchFailure{
					Id:      id,
					Message: "模型不存在",
				})
			}
		}
		return nil
	})
	if err != nil {
		// The transaction rolled back, so the accumulated counts describe writes
		// that no longer exist.
		return ModelTagBatchResult{Failures: make([]ModelTagBatchFailure, 0)}, err
	}
	return result, nil
}

// parseModelSyncFilter maps UI/API sync values to the models.sync_official column.
// Returns ok=false when no sync filter should be applied.
func parseModelSyncFilter(syncOfficial string) (value int, ok bool) {
	switch strings.ToLower(strings.TrimSpace(syncOfficial)) {
	case "", "all":
		return 0, false
	case "yes", "1":
		return 1, true
	case "no", "0":
		return 0, true
	default:
		n, err := strconv.Atoi(syncOfficial)
		if err != nil {
			return 0, false
		}
		return n, true
	}
}
