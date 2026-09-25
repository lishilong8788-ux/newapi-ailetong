package model

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/samber/lo"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Ability struct {
	Group     string  `json:"group" gorm:"type:varchar(64);primaryKey;autoIncrement:false"`
	Model     string  `json:"model" gorm:"type:varchar(255);primaryKey;autoIncrement:false"`
	ChannelId int     `json:"channel_id" gorm:"primaryKey;autoIncrement:false;index"`
	Enabled   bool    `json:"enabled"`
	Priority  *int64  `json:"priority" gorm:"bigint;default:0;index"`
	Weight    uint    `json:"weight" gorm:"default:0;index"`
	Tag       *string `json:"tag" gorm:"index"`
}

type AbilityWithChannel struct {
	Ability
	ChannelType int `json:"channel_type"`
}

func GetAllEnableAbilityWithChannels() ([]AbilityWithChannel, error) {
	var abilities []AbilityWithChannel
	err := DB.Table("abilities").
		Select("abilities.*, channels.type as channel_type").
		Joins("left join channels on abilities.channel_id = channels.id").
		Where("abilities.enabled = ?", true).
		Scan(&abilities).Error
	return abilities, err
}

func GetGroupEnabledModels(group string) []string {
	var models []string
	// Find distinct models
	DB.Table("abilities").Where(commonGroupCol+" = ? and enabled = ?", group, true).Distinct("model").Pluck("model", &models)
	return models
}

func GetEnabledModels() []string {
	var models []string
	// Find distinct models
	DB.Table("abilities").Where("enabled = ?", true).Distinct("model").Pluck("model", &models)
	return models
}

func GetAllEnableAbilities() []Ability {
	var abilities []Ability
	DB.Find(&abilities, "enabled = ?", true)
	return abilities
}

// ModelChannelOption is one routable model together with the channels that can
// serve it, for an operator picking both at once (the ops copilot's own model).
//
// Derived from abilities rather than from the configured model list, so the
// options are exactly what the router would consider: a model whose only channel
// is disabled never shows up, and picking a pair from this list cannot produce a
// request that has nowhere to go.
type ModelChannelOption struct {
	Model    string               `json:"model"`
	Channels []ModelChannelChoice `json:"channels"`
}

// ModelChannelChoice is one channel serving a model. Deliberately minimal: a
// picker needs to name the line, not to price or diagnose it.
type ModelChannelChoice struct {
	ChannelId int    `json:"channel_id"`
	Name      string `json:"name"`
	// Code is the channel's public line code, absent when the operator set none.
	Code string `json:"code,omitempty"`
	Type int    `json:"type"`
}

// GetModelChannelOptions lists every model the given groups can route, each with
// its enabled channels — models ascending, channels by id.
//
// Groups are the caller's own reachable set. Passing every group would offer a
// model that the copilot's own group cannot actually reach, which fails only at
// the first message.
func GetModelChannelOptions(groups []string) []*ModelChannelOption {
	if len(groups) == 0 {
		return nil
	}

	channelsByModel := make(map[string]map[int]struct{})
	choices := make(map[int]ModelChannelChoice)
	record := func(modelName string, choice ModelChannelChoice) {
		if _, ok := channelsByModel[modelName]; !ok {
			channelsByModel[modelName] = make(map[int]struct{})
		}
		// A model reachable in several groups yields one row per group; the picker
		// wants one entry per channel.
		channelsByModel[modelName][choice.ChannelId] = struct{}{}
		choices[choice.ChannelId] = choice
	}

	if common.MemoryCacheEnabled {
		channelSyncLock.RLock()
		for _, group := range groups {
			for modelName, channelIds := range group2model2channels[group] {
				for _, channelId := range channelIds {
					channel, ok := channelsIDM[channelId]
					if !ok || channel.Status != common.ChannelStatusEnabled {
						continue
					}
					record(modelName, ModelChannelChoice{
						ChannelId: channel.Id,
						Name:      channel.Name,
						Code:      channel.GetLineCode(),
						Type:      channel.Type,
					})
				}
			}
		}
		channelSyncLock.RUnlock()
	} else {
		for _, row := range modelChannelOptionRows(groups) {
			choice := ModelChannelChoice{
				ChannelId: row.ChannelId,
				Name:      row.Name,
				Type:      row.Type,
			}
			if row.LineCode != nil {
				choice.Code = strings.TrimSpace(*row.LineCode)
			}
			record(row.Model, choice)
		}
	}

	options := make([]*ModelChannelOption, 0, len(channelsByModel))
	for modelName, channelIds := range channelsByModel {
		option := &ModelChannelOption{Model: modelName, Channels: make([]ModelChannelChoice, 0, len(channelIds))}
		for channelId := range channelIds {
			option.Channels = append(option.Channels, choices[channelId])
		}
		sort.Slice(option.Channels, func(i, j int) bool {
			return option.Channels[i].ChannelId < option.Channels[j].ChannelId
		})
		options = append(options, option)
	}
	sort.Slice(options, func(i, j int) bool { return options[i].Model < options[j].Model })
	return options
}

type modelChannelOptionRow struct {
	Model     string
	ChannelId int
	Name      string
	LineCode  *string
	Type      int
}

// modelChannelOptionRows serves installations running with the memory cache off.
func modelChannelOptionRows(groups []string) []modelChannelOptionRow {
	var rows []modelChannelOptionRow
	err := DB.Table("abilities").
		Select("abilities.model as model, abilities.channel_id as channel_id, channels.name as name, channels.line_code as line_code, channels.type as type").
		Joins("join channels on channels.id = abilities.channel_id").
		Where("abilities."+commonGroupCol+" IN ? AND abilities.enabled = ?", groups, true).
		Where("channels.status = ?", common.ChannelStatusEnabled).
		Scan(&rows).Error
	if err != nil {
		common.SysError("failed to list model channel options: " + err.Error())
		return nil
	}
	return rows
}

// Tier walking used to live here as getPriorityOnLine: a second query that
// resolved which priority tier a retry should land on. selectCandidate now does
// that in Go over the candidate set, for both selection paths at once, so the
// query is gone.

// getChannelQuery builds the candidate-ability query for the DB selection path.
//
// It deliberately does NOT rank: no priority filter, no ordering. Ranking is
// selectCandidate's job, shared with the cached path. This split is the fix for a
// structural problem — priority used to be resolved inside SQL via
// MAX(priority), which left nowhere to inject a Go-side ranking input like the
// price rank table, so auto-route could not work on this path at all.
//
// The cost is fetching every candidate row for the model instead of just the top
// tier. That is a handful of rows per model in practice, and the alternative is
// keeping routing policy split across SQL and Go.
//
// onLineChannelIds, when non-empty, restricts candidates to those channels. The
// pin has to narrow before ranking so the pinned line's channels tier among
// themselves, matching the cached path.
func getChannelQuery(group string, model string, onLineChannelIds []int) *gorm.DB {
	scope := func() *gorm.DB {
		query := DB.Model(&Ability{}).Where(commonGroupCol+" = ? and model = ? and enabled = ?", group, model, true)
		if len(onLineChannelIds) > 0 {
			query = query.Where("channel_id in (?)", onLineChannelIds)
		}
		return query
	}

	return scope()
}

// GetChannel is the DB (non-memory-cache) channel selection path. A non-empty
// lineCode narrows candidates to that line, keeping the full set when the line has
// nothing usable — the same preference-not-restriction semantics as the cached
// path's filterChannelsByLineCode, so a pinned line that is down still falls back
// instead of failing the request.
func GetChannel(group string, model string, retry int, requestPath string, lineCode string) (*Channel, error) {
	var abilities []Ability

	// Resolved before the query so the pinned line narrows candidates ahead of
	// ranking; an unusable line yields nil and the full set is queried instead.
	onLineChannelIds := channelIdsOnLine(group, model, lineCode)
	err := getChannelQuery(group, model, onLineChannelIds).Find(&abilities).Error
	if err != nil {
		return nil, err
	}
	abilities = filterAbilitiesByRequestPathAndModel(abilities, requestPath, model)
	if len(abilities) == 0 {
		return nil, nil
	}

	candidates := make([]Candidate, 0, len(abilities))
	for _, ability := range abilities {
		// Priority is nullable on abilities; absent means 0, the same default
		// Channel.GetPriority applies on the cached path.
		var priority int64
		if ability.Priority != nil {
			priority = *ability.Priority
		}
		candidates = append(candidates, Candidate{
			ChannelID: ability.ChannelId,
			Priority:  priority,
			Weight:    int(ability.Weight),
		})
	}

	// resolveStrategy reads the price rank table, which is swapped under
	// channelSyncLock's write lock. The cached path already holds the read lock by
	// the time it resolves; this path has to take it itself.
	channelSyncLock.RLock()
	strategy := resolveStrategy(model)
	channelSyncLock.RUnlock()

	selectedID, err := selectCandidate(candidates, strategy, retry)
	if err != nil {
		return nil, err
	}

	channel := Channel{}
	err = DB.First(&channel, "id = ?", selectedID).Error
	return &channel, err
}

// channelIdsOnLine returns the enabled channels serving this group/model that
// publish lineCode, or nil when the line has none usable — nil meaning "no
// narrowing", so an unhonorable pin degrades to normal selection rather than
// failing the request.
//
// The line code lives on channels while candidates come from abilities, so this is
// a join expressed as one extra query. Only runs on the DB selection path when a
// pin was actually requested.
func channelIdsOnLine(group string, model string, lineCode string) []int {
	if lineCode == "" {
		return nil
	}

	var ids []int
	err := DB.Model(&Ability{}).
		Joins("join channels on channels.id = abilities.channel_id").
		Where("abilities."+commonGroupCol+" = ? and abilities.model = ? and abilities.enabled = ?", group, model, true).
		Where("channels.status = ? and channels.line_code = ?", common.ChannelStatusEnabled, lineCode).
		Distinct().
		Pluck("abilities.channel_id", &ids).Error
	if err != nil {
		common.SysError("failed to resolve channels on line " + lineCode + ": " + err.Error())
		return nil
	}
	return ids
}

// filterAbilitiesByRequestPathAndModel restricts candidates by request path and
// model for the DB (non-memory-cache) selection path. Only Advanced Custom
// (type 58) channels are path-checked: kept only when one of their routes matches
// requestPath and model; all other channel types always pass. When requestPath is
// empty, filtering is skipped.
func filterAbilitiesByRequestPathAndModel(abilities []Ability, requestPath string, model string) []Ability {
	if requestPath == "" || len(abilities) == 0 {
		return abilities
	}

	channelIds := make([]int, 0, len(abilities))
	seen := make(map[int]struct{}, len(abilities))
	for _, ability := range abilities {
		if _, ok := seen[ability.ChannelId]; ok {
			continue
		}
		seen[ability.ChannelId] = struct{}{}
		channelIds = append(channelIds, ability.ChannelId)
	}

	var channels []*Channel
	if err := DB.Where("id IN ?", channelIds).Find(&channels).Error; err != nil {
		// On error, fall back to unfiltered candidates to avoid blocking selection
		return abilities
	}

	advancedConfigs := make(map[int]*dto.AdvancedCustomConfig)
	for _, channel := range channels {
		if channel.Type == constant.ChannelTypeAdvancedCustom {
			advancedConfigs[channel.Id] = channel.GetOtherSettings().AdvancedCustom
		}
	}

	filtered := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		config, isAdvancedCustom := advancedConfigs[ability.ChannelId]
		if !isAdvancedCustom {
			filtered = append(filtered, ability)
			continue
		}
		if config != nil && config.SupportsPathForModel(requestPath, model) {
			filtered = append(filtered, ability)
		}
	}
	return filtered
}

func (channel *Channel) AddAbilities(tx *gorm.DB) error {
	models_ := strings.Split(channel.Models, ",")
	groups_ := strings.Split(channel.Group, ",")
	abilitySet := make(map[string]struct{})
	abilities := make([]Ability, 0, len(models_))
	for _, model := range models_ {
		for _, group := range groups_ {
			key := group + "|" + model
			if _, exists := abilitySet[key]; exists {
				continue
			}
			abilitySet[key] = struct{}{}
			ability := Ability{
				Group:     group,
				Model:     model,
				ChannelId: channel.Id,
				Enabled:   channel.Status == common.ChannelStatusEnabled,
				Priority:  channel.Priority,
				Weight:    uint(channel.GetWeight()),
				Tag:       channel.Tag,
			}
			abilities = append(abilities, ability)
		}
	}
	if len(abilities) == 0 {
		return nil
	}
	// choose DB or provided tx
	useDB := DB
	if tx != nil {
		useDB = tx
	}
	for _, chunk := range lo.Chunk(abilities, 50) {
		err := useDB.Clauses(clause.OnConflict{DoNothing: true}).Create(&chunk).Error
		if err != nil {
			return err
		}
	}
	return nil
}

func (channel *Channel) DeleteAbilities() error {
	return DB.Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error
}

// UpdateAbilities updates abilities of this channel.
// Make sure the channel is completed before calling this function.
func (channel *Channel) UpdateAbilities(tx *gorm.DB) error {
	isNewTx := false
	// 如果没有传入事务，创建新的事务
	if tx == nil {
		tx = DB.Begin()
		if tx.Error != nil {
			return tx.Error
		}
		isNewTx = true
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()
	}

	// First delete all abilities of this channel
	err := tx.Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error
	if err != nil {
		if isNewTx {
			tx.Rollback()
		}
		return err
	}

	// Then add new abilities
	models_ := strings.Split(channel.Models, ",")
	groups_ := strings.Split(channel.Group, ",")
	abilitySet := make(map[string]struct{})
	abilities := make([]Ability, 0, len(models_))
	for _, model := range models_ {
		for _, group := range groups_ {
			key := group + "|" + model
			if _, exists := abilitySet[key]; exists {
				continue
			}
			abilitySet[key] = struct{}{}
			ability := Ability{
				Group:     group,
				Model:     model,
				ChannelId: channel.Id,
				Enabled:   channel.Status == common.ChannelStatusEnabled,
				Priority:  channel.Priority,
				Weight:    uint(channel.GetWeight()),
				Tag:       channel.Tag,
			}
			abilities = append(abilities, ability)
		}
	}

	if len(abilities) > 0 {
		for _, chunk := range lo.Chunk(abilities, 50) {
			err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&chunk).Error
			if err != nil {
				if isNewTx {
					tx.Rollback()
				}
				return err
			}
		}
	}

	// 如果是新创建的事务，需要提交
	if isNewTx {
		return tx.Commit().Error
	}

	return nil
}

func UpdateAbilityStatus(channelId int, status bool) error {
	return DB.Model(&Ability{}).Where("channel_id = ?", channelId).Select("enabled").Update("enabled", status).Error
}

func UpdateAbilityStatusByTag(tag string, status bool) error {
	return DB.Model(&Ability{}).Where("tag = ?", tag).Select("enabled").Update("enabled", status).Error
}

func UpdateAbilityByTag(tag string, newTag *string, priority *int64, weight *uint) error {
	ability := Ability{}
	if newTag != nil {
		ability.Tag = newTag
	}
	if priority != nil {
		ability.Priority = priority
	}
	if weight != nil {
		ability.Weight = *weight
	}
	return DB.Model(&Ability{}).Where("tag = ?", tag).Updates(ability).Error
}

var fixLock = sync.Mutex{}

func FixAbility() (int, int, error) {
	lock := fixLock.TryLock()
	if !lock {
		return 0, 0, errors.New("已经有一个修复任务在运行中，请稍后再试")
	}
	defer fixLock.Unlock()

	// truncate abilities table
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		err := DB.Exec("DELETE FROM abilities").Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Delete abilities failed: %s", err.Error()))
			return 0, 0, err
		}
	} else {
		err := DB.Exec("TRUNCATE TABLE abilities").Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Truncate abilities failed: %s", err.Error()))
			return 0, 0, err
		}
	}
	var channels []*Channel
	// Find all channels
	err := DB.Model(&Channel{}).Find(&channels).Error
	if err != nil {
		return 0, 0, err
	}
	if len(channels) == 0 {
		return 0, 0, nil
	}
	successCount := 0
	failCount := 0
	for _, chunk := range lo.Chunk(channels, 50) {
		ids := lo.Map(chunk, func(c *Channel, _ int) int { return c.Id })
		// Delete all abilities of this channel
		err = DB.Where("channel_id IN ?", ids).Delete(&Ability{}).Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Delete abilities failed: %s", err.Error()))
			failCount += len(chunk)
			continue
		}
		// Then add new abilities
		for _, channel := range chunk {
			err = channel.AddAbilities(nil)
			if err != nil {
				common.SysLog(fmt.Sprintf("Add abilities for channel %d failed: %s", channel.Id, err.Error()))
				failCount++
			} else {
				successCount++
			}
		}
	}
	InitChannelCache()
	return successCount, failCount, nil
}
