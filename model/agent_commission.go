package model

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// reversedSourceSuffix distinguishes a reversal's source key from the row it
// offsets, so both can live under the same unique index.
const reversedSourceSuffix = ":reversed"

// agentRemarkMaxRunes matches the varchar(255) remark column. Operator-supplied
// reasons are truncated by rune so a multi-byte reason is not cut mid-character.
const agentRemarkMaxRunes = 255

func truncateAgentRemark(remark string) string {
	if runes := []rune(remark); len(runes) > agentRemarkMaxRunes {
		return string(runes[:agentRemarkMaxRunes])
	}
	return remark
}

// ErrCommissionSourceInvalid rejects a ledger row with no usable source key. The
// (agent, source_type, source_id) unique index is the only thing standing between
// a replayed payment callback and a double payout, and an empty or zero key would
// make every such row collide with every other.
var ErrCommissionSourceInvalid = errors.New("commission source is invalid")

// isDuplicateKeyError reports whether err is a unique-constraint violation.
//
// gorm.ErrDuplicatedKey only appears when the dialector's error translation is
// enabled, which this project's gorm.Config does not set, so the driver error
// text is the fallback that actually fires. All three supported databases are
// covered: MySQL 1062, PostgreSQL 23505, and SQLite's constraint message.
func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate entry") || // MySQL 1062
		strings.Contains(msg, "duplicate key value") || // PostgreSQL 23505
		strings.Contains(msg, "unique constraint") || // PostgreSQL wording / SQLite
		strings.Contains(msg, "constraint failed: unique") // SQLite wording
}

// RecordCommissionTx inserts one ledger row inside the caller's top-up
// transaction.
//
// Deliberately no row lock and no update of the agent's user row: a popular agent
// whose customers top up concurrently would become a write hotspot, and every
// such top-up would serialize behind the commission bookkeeping. A bare INSERT
// contends with nothing, and the summary columns are refreshed outside the
// transaction by RefreshAgentCommissionSummary (design 5.3).
//
// Callers must treat ErrCommissionDuplicate as success: a replayed payment
// callback is routine, and the unique index — not a read-then-insert check, which
// races — is what makes the replay harmless.
func RecordCommissionTx(tx *gorm.DB, c *AgentCommission) error {
	if c == nil {
		return ErrCommissionSourceInvalid
	}
	if c.AgentUserId <= 0 {
		return ErrAgentProfileNotFound
	}
	if c.SourceType == "" || c.SourceId <= 0 {
		return ErrCommissionSourceInvalid
	}
	// A user must never earn commission on their own spending.
	if c.AgentUserId == c.FromUserId {
		return ErrAgentSelfReferral
	}

	if c.Status == "" {
		c.Status = CommissionStatusPending
	}
	// A pending row with no maturity date would never be picked up by the freeze
	// window job and the money would be stranded, so the window is filled in here
	// rather than trusted from the caller.
	if c.Status == CommissionStatusPending && c.AvailableTime <= 0 {
		c.AvailableTime = common.GetTimestamp() + int64(setting.AgentFreezeDays)*86400
	}

	if err := tx.Create(c).Error; err != nil {
		if isDuplicateKeyError(err) {
			return ErrCommissionDuplicate
		}
		return err
	}
	return nil
}

// withdrawablePoolStatuses is the set of ledger rows that make up the
// withdrawable pool.
//
// Reversed rows count toward the pool even though they are never claimed. A
// reversal is the negative row written when a customer's top-up is refunded, and
// the design (5.5) makes that debt reduce what the agent may withdraw, carrying a
// negative balance until later commission absorbs it. Excluding them would let an
// agent whose customers all charged back still withdraw the full original amount.
//
// Because they are never claimed, a reversal keeps depressing the pool until an
// operator books it off with a negative AdjustCommission — which does join the
// claimable set. Netting reversals against settled rows automatically would mean
// splitting a row mid-amount, and this ledger never rewrites history.
func withdrawablePoolStatuses() []string {
	return []string{CommissionStatusSettled, CommissionStatusReversed}
}

// SumWithdrawableCommission aggregates the withdrawable pool for display. It
// takes no lock and may be stale the moment it returns; CreateWithdrawal
// recomputes the same sum under a row lock before any money moves.
func SumWithdrawableCommission(userId int) (float64, error) {
	var total float64
	err := DB.Model(&AgentCommission{}).
		Where("agent_user_id = ? AND status IN ?", userId, withdrawablePoolStatuses()).
		Select("COALESCE(SUM(amount), 0)").Scan(&total).Error
	return total, err
}

// ClaimCommissionForWithdrawal reserves ledger rows for one withdrawal inside the
// caller's transaction.
//
// The available balance is aggregated from the locked rows themselves. It is
// never "total earned minus already withdrawn": that subtraction lets two
// concurrent requests read the same balance, both pass the check, and together
// take twice the money. Validating and claiming under one lock makes overdraw
// impossible (design 6.1).
//
// Rows are claimed whole, oldest first. When the requested amount falls partway
// through a row, that entire row is still claimed — the agent receives exactly
// the amount they asked for, and the over-claimed remainder stays attributed to
// this withdrawal. Splitting the row would mean rewriting a history entry, which
// this ledger never does; the alternative, leaving the row unclaimed, would let
// the same money be claimed twice.
func ClaimCommissionForWithdrawal(tx *gorm.DB, userId int, amount float64, withdrawalId int) error {
	// NaN fails every comparison below, so it is rejected explicitly rather than
	// slipping through as "not less than".
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return ErrWithdrawalAmountInvalid
	}
	if withdrawalId <= 0 {
		return ErrWithdrawalNotFound
	}

	// Reversed rows are locked and summed with the settled ones so an outstanding
	// refund debt is subtracted from the gate, but only settled rows are claimed
	// below.
	var rows []*AgentCommission
	if err := lockForUpdate(tx).
		Where("agent_user_id = ? AND status IN ?", userId, withdrawablePoolStatuses()).
		Order("create_time asc, id asc").
		Find(&rows).Error; err != nil {
		return err
	}

	requested := decimal.NewFromFloat(amount)
	available := decimal.Zero
	for _, row := range rows {
		available = available.Add(decimal.NewFromFloat(row.Amount))
	}
	if available.LessThan(requested) {
		return ErrCommissionInsufficient
	}

	claimed := decimal.Zero
	claimedIds := make([]int, 0, len(rows))
	for _, row := range rows {
		if row.Status != CommissionStatusSettled {
			continue
		}
		claimedIds = append(claimedIds, row.Id)
		claimed = claimed.Add(decimal.NewFromFloat(row.Amount))
		if claimed.GreaterThanOrEqual(requested) {
			break
		}
	}
	// The pool cleared the gate but no settled row can cover it, which means the
	// balance is made up of reversals. There is nothing to claim and nothing to pay.
	if len(claimedIds) == 0 || claimed.LessThan(requested) {
		return ErrCommissionInsufficient
	}

	result := tx.Model(&AgentCommission{}).
		Where("id IN ? AND status = ?", claimedIds, CommissionStatusSettled).
		Updates(map[string]interface{}{
			"status":        CommissionStatusFrozen,
			"withdrawal_id": withdrawalId,
		})
	if result.Error != nil {
		return result.Error
	}
	// SQLite takes no row lock, so the status is re-asserted in the WHERE clause
	// and the row count verified: a concurrent claim that took any of these rows
	// first must fail this withdrawal rather than pay out rows it does not own.
	if result.RowsAffected != int64(len(claimedIds)) {
		return ErrCommissionInsufficient
	}
	return nil
}

// ReleaseCommissionForWithdrawal returns claimed rows to the withdrawable pool
// after a rejection or a failed payout. Clearing withdrawal_id matters as much as
// the status: a released row still pointing at a dead withdrawal would read as
// spoken for in the finance audit view.
func ReleaseCommissionForWithdrawal(tx *gorm.DB, withdrawalId int) error {
	return tx.Model(&AgentCommission{}).
		Where("withdrawal_id = ? AND status = ?", withdrawalId, CommissionStatusFrozen).
		Updates(map[string]interface{}{
			"status":        CommissionStatusSettled,
			"withdrawal_id": 0,
		}).Error
}

// MarkCommissionPaid settles claimed rows once the money has left. withdrawal_id
// is kept so finance can still trace which payout consumed which commission.
func MarkCommissionPaid(tx *gorm.DB, withdrawalId int) error {
	return tx.Model(&AgentCommission{}).
		Where("withdrawal_id = ? AND status = ?", withdrawalId, CommissionStatusFrozen).
		Update("status", CommissionStatusPaid).Error
}

// SettleMaturedCommissions moves commission out of the freeze window and returns
// how many rows matured. The window is the only barrier against the top-up →
// withdraw → refund arbitrage, so nothing else may promote a pending row.
func SettleMaturedCommissions() (int64, error) {
	result := DB.Model(&AgentCommission{}).
		Where("status = ? AND available_time > 0 AND available_time <= ?",
			CommissionStatusPending, common.GetTimestamp()).
		Update("status", CommissionStatusSettled)
	return result.RowsAffected, result.Error
}

// ReverseCommission offsets a refunded top-up by appending a negative row. The
// original is never updated or deleted: it may already be frozen against a
// withdrawal or even paid out, and rewriting it would leave the books unable to
// explain money that has already left.
//
// The reversal carries its own source key (the original type suffixed with
// ":reversed") so the unique index gives replay protection here too — a refund
// callback that fires twice reverses once.
func ReverseCommission(agentUserId int, sourceType string, sourceId int, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return ErrAgentReasonRequired
	}

	// source_type is varchar(32) and the reversal needs room for the suffix. A
	// longer type would be silently truncated by MySQL outside strict mode, which
	// would collapse two distinct source keys into one.
	if len(sourceType)+len(reversedSourceSuffix) > 32 {
		return ErrCommissionSourceInvalid
	}

	var original AgentCommission
	err := DB.Where("agent_user_id = ? AND source_type = ? AND source_id = ?",
		agentUserId, sourceType, sourceId).First(&original).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrCommissionSourceInvalid
		}
		return err
	}
	// Already reversed: the offsetting row exists, and writing a second one would
	// claw back the amount twice.
	if original.Status == CommissionStatusReversed {
		return ErrCommissionDuplicate
	}

	reversal := &AgentCommission{
		AgentUserId: original.AgentUserId,
		FromUserId:  original.FromUserId,
		SourceType:  sourceType + reversedSourceSuffix,
		SourceId:    sourceId,
		BaseAmount:  decimal.NewFromFloat(original.BaseAmount).Neg().InexactFloat64(),
		Rate:        original.Rate,
		Amount:      decimal.NewFromFloat(original.Amount).Neg().InexactFloat64(),
		Status:      CommissionStatusReversed,
		Remark:      truncateAgentRemark(reason),
	}
	return RecordCommissionTx(DB, reversal)
}

// adjustSourceIdMaxAttempts bounds the retry loop that finds a free source key
// for a manual adjustment.
const adjustSourceIdMaxAttempts = 3

// AdjustCommission appends a manual correction. Adjustments are settled on
// arrival because an operator has already made the decision the freeze window
// exists to delay, and they are appended rather than applied to the mistaken row
// so both the error and its correction stay on the record.
//
// A negative amount is the supported way to book an agent's debt to the platform
// against future commission: unlike a reversal it joins the withdrawable pool and
// is consumed by the next claim.
func AdjustCommission(agentUserId int, amount float64, adminId int, reason string) error {
	if agentUserId <= 0 {
		return ErrAgentProfileNotFound
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount == 0 {
		return ErrWithdrawalAmountInvalid
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return ErrAgentReasonRequired
	}

	// An adjustment has no upstream order, so the source key is a timestamp. Two
	// corrections to the same agent within one second would collide on the unique
	// index, which is a conflict to retry past rather than an error to report.
	var lastErr error
	for attempt := 0; attempt < adjustSourceIdMaxAttempts; attempt++ {
		adjustment := &AgentCommission{
			AgentUserId: agentUserId,
			SourceType:  CommissionSourceAdjust,
			SourceId:    int(common.GetTimestamp()) + attempt,
			Amount:      decimal.NewFromFloat(amount).Round(2).InexactFloat64(),
			Status:      CommissionStatusSettled,
			Remark:      truncateAgentRemark(fmt.Sprintf("admin #%d: %s", adminId, reason)),
		}
		lastErr = RecordCommissionTx(DB, adjustment)
		if !errors.Is(lastErr, ErrCommissionDuplicate) {
			return lastErr
		}
	}
	return lastErr
}

// CommissionFilters narrows a ledger query. MinAmount and MaxAmount are pointers
// because zero is a meaningful bound: "at most 0" is how an operator finds the
// clawbacks.
type CommissionFilters struct {
	Status     string
	SourceType string
	FromUserId int
	StartTime  int64
	EndTime    int64
	MinAmount  *float64
	MaxAmount  *float64
}

// AgentCommissionWithUser is one ledger row with both accounts named, so an
// operator reconciling a dispute sees who earned it and whose spending produced it
// without a per-row lookup.
type AgentCommissionWithUser struct {
	*AgentCommission
	AgentUsername string `json:"agent_username"`
	FromUsername  string `json:"from_username"`
}

// GetAgentCommissions lists ledger rows. An agentUserId of 0 means the
// all-agents admin view; any positive value scopes the query to that agent, which
// is what keeps one agent's ledger out of another's reach.
func GetAgentCommissions(agentUserId int, filters CommissionFilters, pageInfo *common.PageInfo) ([]*AgentCommissionWithUser, int64, error) {
	query := DB.Model(&AgentCommission{}).
		Select("agent_commissions.*, " +
			"COALESCE(agent_user.username, '') AS agent_username, " +
			"COALESCE(from_user.username, '') AS from_username").
		Joins("LEFT JOIN users AS agent_user ON agent_user.id = agent_commissions.agent_user_id AND agent_user.deleted_at IS NULL").
		Joins("LEFT JOIN users AS from_user ON from_user.id = agent_commissions.from_user_id AND from_user.deleted_at IS NULL")

	if agentUserId > 0 {
		query = query.Where("agent_commissions.agent_user_id = ?", agentUserId)
	}

	if filters.Status != "" {
		query = query.Where("agent_commissions.status = ?", filters.Status)
	}
	if filters.SourceType != "" {
		query = query.Where("agent_commissions.source_type = ?", filters.SourceType)
	}
	if filters.FromUserId > 0 {
		query = query.Where("agent_commissions.from_user_id = ?", filters.FromUserId)
	}
	if filters.StartTime > 0 {
		query = query.Where("agent_commissions.create_time >= ?", filters.StartTime)
	}
	if filters.EndTime > 0 {
		query = query.Where("agent_commissions.create_time <= ?", filters.EndTime)
	}
	if filters.MinAmount != nil {
		query = query.Where("agent_commissions.amount >= ?", *filters.MinAmount)
	}
	if filters.MaxAmount != nil {
		query = query.Where("agent_commissions.amount <= ?", *filters.MaxAmount)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []*AgentCommissionWithUser
	err := query.Order("agent_commissions.create_time desc, agent_commissions.id desc").
		Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// RefreshAgentCommissionSummary recomputes the denormalized summaries on the
// user row from the ledger.
//
// Called after a transaction commits, never inside one: updating the agent's user
// row while holding the top-up transaction would make a popular agent a write
// hotspot for all of their customers' payments. A stale summary is acceptable
// because nothing decides money from it.
func RefreshAgentCommissionSummary(userId int) error {
	if userId <= 0 {
		return ErrAgentProfileNotFound
	}

	var totals []struct {
		Status string
		Total  float64
	}
	if err := DB.Model(&AgentCommission{}).
		Select("status, COALESCE(SUM(amount), 0) AS total").
		Where("agent_user_id = ?", userId).
		Group("status").
		Find(&totals).Error; err != nil {
		return err
	}

	commissionTotal := decimal.Zero
	commissionAvailable := decimal.Zero
	for _, row := range totals {
		amount := decimal.NewFromFloat(row.Total)
		// Gross earnings exclude reversals: the dashboard figure answers "what has
		// this agent earned", and a refund is reported through the available
		// balance and the ledger view instead (design 9.3).
		if row.Status != CommissionStatusReversed {
			commissionTotal = commissionTotal.Add(amount)
		}
		if row.Status == CommissionStatusSettled || row.Status == CommissionStatusReversed {
			commissionAvailable = commissionAvailable.Add(amount)
		}
	}

	// Withdrawn comes from the paid withdrawals, not from the paid ledger rows:
	// rows are claimed whole, so a claim can exceed the amount actually paid and
	// the ledger side would overstate what the agent received.
	var withdrawnTotal float64
	if err := DB.Model(&AgentWithdrawal{}).
		Where("agent_user_id = ? AND status = ?", userId, WithdrawalStatusPaid).
		Select("COALESCE(SUM(amount), 0)").Scan(&withdrawnTotal).Error; err != nil {
		return err
	}

	return DB.Model(&User{}).Where("id = ?", userId).
		Updates(map[string]interface{}{
			"agent_commission_total":     commissionTotal.InexactFloat64(),
			"agent_commission_available": commissionAvailable.InexactFloat64(),
			"agent_withdrawn_total":      withdrawnTotal,
		}).Error
}

// refreshAgentSummaryBestEffort updates the denormalized summaries after money
// has moved. A failure here is logged and swallowed: the funds transaction has
// already committed, and a stale display column must never turn a completed
// payout into an error the caller might retry.
func refreshAgentSummaryBestEffort(userId int) {
	if err := RefreshAgentCommissionSummary(userId); err != nil {
		common.SysError(fmt.Sprintf("failed to refresh agent commission summary for user %d: %s", userId, err.Error()))
	}
}

