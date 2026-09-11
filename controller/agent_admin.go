package controller

import (
	"encoding/csv"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// Admin agent endpoints are intentionally not gated on setting.AgentEnabled: an
// operator who turns the programme off still has to settle the withdrawals and
// commission already in flight.
//
// Route note: the :id segment of every /profiles/:id route is the agent's USER
// id, not agent_profile.id. One identifier for the whole agent surface keeps the
// admin console from having to track two, and the profile row is unique per user.

// AdminGetAgentProfiles lists agents for the management console.
func AdminGetAgentProfiles(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	profiles, total, err := model.GetAgentProfiles(c.Query("status"), c.Query("keyword"), pageInfo)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	for _, profile := range profiles {
		// Design doc 13.3: the list is masked. Only the withdrawal detail screen,
		// which finance pays from, shows the full account.
		profile.BankAccount = maskBankAccount(profile.BankAccount)
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(profiles)
	common.ApiSuccess(c, pageInfo)
}

// AdminGetAgentProfileDetail returns one agent's full record, bank account
// included: an operator reviewing an identity submission has to see what was
// submitted.
func AdminGetAgentProfileDetail(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	profile, err := model.GetAgentProfileByUserId(userId)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	available, err := model.SumWithdrawableCommission(userId)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	var customerCount int64
	if err := model.DB.Model(&model.User{}).Where("inviter_id = ?", userId).Count(&customerCount).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"profile":        profile,
		"effective_rate": setting.EffectiveCommissionRate(profile.CommissionRate),
		"stats": gin.H{
			"available":      available,
			"customer_count": customerCount,
		},
	})
}

type AdminAuditAgentProfileRequest struct {
	Approve bool   `json:"approve"`
	Reason  string `json:"reason"`
}

// AdminAuditAgentProfile approves or rejects an identity submission. Approval is
// what unlocks withdrawals, so the action is one of the four that must leave an
// audit record (design doc 13.4).
func AdminAuditAgentProfile(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminAuditAgentProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if !req.Approve && reason == "" {
		common.ApiErrorMsg(c, "请填写驳回原因")
		return
	}
	if len([]rune(reason)) > 255 {
		common.ApiErrorMsg(c, "原因长度不能超过 255 个字符")
		return
	}

	profile, err := model.GetAgentProfileByUserId(userId)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	statusBefore := profile.Status
	if err := model.AuditAgentProfile(profile.Id, c.GetInt("id"), req.Approve, reason); err != nil {
		respondAgentError(c, err)
		return
	}
	recordManageAuditFor(c, userId, "agent.profile_audit", map[string]interface{}{
		"profile_id":  profile.Id,
		"approve":     req.Approve,
		"from_status": statusBefore,
		"to_status":   auditedAgentStatus(req.Approve),
		"reason":      reason,
	})
	common.ApiSuccess(c, nil)
}

// auditedAgentStatus names the status an audit decision lands on, so the audit
// record carries the before/after pair design doc 13.4 asks for.
func auditedAgentStatus(approve bool) string {
	if approve {
		return model.AgentStatusActive
	}
	return model.AgentStatusRejected
}

type AdminSetAgentRateRequest struct {
	// Rate is a pointer so "clear the override and follow the global default"
	// stays distinguishable from "set it to zero, pay nothing".
	Rate *float64 `json:"rate"`
}

// AdminSetAgentRate changes one agent's commission rate. The ceiling is enforced
// here and not only in the form: a mistyped 1.5 would make every top-up a net
// loss (design doc 12).
func AdminSetAgentRate(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminSetAgentRateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if req.Rate != nil {
		rate := *req.Rate
		if math.IsNaN(rate) || math.IsInf(rate, 0) || !setting.IsCommissionRateValid(rate) {
			common.ApiErrorMsg(c, fmt.Sprintf("分佣比例必须在 0 ~ %g 之间", setting.AgentMaxRate))
			return
		}
	}

	profile, err := model.GetAgentProfileByUserId(userId)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	if err := model.SetAgentCommissionRate(userId, req.Rate); err != nil {
		respondAgentError(c, err)
		return
	}
	recordManageAuditFor(c, userId, "agent.rate_change", map[string]interface{}{
		"profile_id": profile.Id,
		"from_rate":  formatCommissionRate(profile.CommissionRate),
		"to_rate":    formatCommissionRate(req.Rate),
	})
	common.ApiSuccess(c, nil)
}

// formatCommissionRate renders a rate for the audit record, keeping "unset"
// distinct from "zero" - the two mean different money.
func formatCommissionRate(rate *float64) string {
	if rate == nil {
		return "default"
	}
	return strconv.FormatFloat(*rate, 'f', -1, 64)
}

type AdminSetAgentStatusRequest struct {
	Status string `json:"status"`
}

// AdminSetAgentStatus enables or suspends an agent. A suspended agent stops
// earning new commission but keeps what is already in the ledger (design doc 4.2),
// so this is not a funds action and the middleware audit fallback covers it.
func AdminSetAgentStatus(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminSetAgentStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	status := strings.TrimSpace(req.Status)
	// Only the operator-driven transitions are accepted. pending / rejected belong
	// to the audit endpoint, and incomplete is what a fresh row starts as.
	if status != model.AgentStatusActive && status != model.AgentStatusSuspended {
		common.ApiErrorMsg(c, "状态无效，只能设置为 active 或 suspended")
		return
	}
	if err := model.SetAgentStatus(userId, status); err != nil {
		respondAgentError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type AdminCreateAgentProfileRequest struct {
	UserId int      `json:"user_id"`
	Rate   *float64 `json:"rate"`
}

// AdminCreateAgentProfile designates an existing user as an agent. Operations uses
// it to enrol a partner who negotiated terms offline instead of waiting for a
// self-service submission.
//
// The new profile starts as incomplete, which is enough to promote and earn
// (design doc 4.2). It is deliberately not activated here: active is only
// reachable from pending through AdminAuditAgentProfile, so the record of who
// approved an agent for withdrawals always exists.
func AdminCreateAgentProfile(c *gin.Context) {
	var req AdminCreateAgentProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if req.UserId <= 0 {
		common.ApiErrorMsg(c, "请选择用户")
		return
	}
	if req.Rate != nil {
		rate := *req.Rate
		if math.IsNaN(rate) || math.IsInf(rate, 0) || !setting.IsCommissionRateValid(rate) {
			common.ApiErrorMsg(c, fmt.Sprintf("分佣比例必须在 0 ~ %g 之间", setting.AgentMaxRate))
			return
		}
	}
	// Confirm the user exists first, otherwise an orphan profile row would appear
	// in the console pointing at nobody.
	if _, err := model.GetUserById(req.UserId, false); err != nil {
		common.ApiErrorMsg(c, "用户不存在")
		return
	}

	profile, err := model.EnsureAgentProfile(req.UserId)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	rateBefore := formatCommissionRate(profile.CommissionRate)
	if req.Rate != nil {
		if err := model.SetAgentCommissionRate(req.UserId, req.Rate); err != nil {
			respondAgentError(c, err)
			return
		}
		profile, err = model.GetAgentProfileByUserId(req.UserId)
		if err != nil {
			respondAgentError(c, err)
			return
		}
	}
	// One record for the whole designation. The rate is part of it, so this also
	// satisfies the rate-change audit requirement for the create path; the
	// manual audit marker suppresses the middleware fallback for this request.
	recordManageAuditFor(c, req.UserId, "agent.profile_create", map[string]interface{}{
		"profile_id": profile.Id,
		"status":     profile.Status,
		"from_rate":  rateBefore,
		"to_rate":    formatCommissionRate(profile.CommissionRate),
	})
	common.ApiSuccess(c, profile)
}

// ---- Admin APIs: withdrawals ----

// AdminGetWithdrawals is the finance worklist. agent_user_id may be supplied here
// because this route is behind AdminAuth; the agent-side list never accepts it.
func AdminGetWithdrawals(c *gin.Context) {
	agentUserId, _ := strconv.Atoi(c.Query("agent_user_id"))
	pageInfo := common.GetPageQuery(c)
	withdrawals, total, err := model.GetWithdrawals(agentUserId, c.Query("status"), c.Query("method"), pageInfo)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	for _, withdrawal := range withdrawals {
		// The snapshot carries the full payee block. Design doc 13.3 keeps it out
		// of the list; the detail endpoint below is the single place it appears.
		withdrawal.ProfileSnapshot = ""
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(withdrawals)
	common.ApiSuccess(c, pageInfo)
}

// AdminGetWithdrawalDetail returns everything finance needs before paying: the
// unmasked payee block and the exact commission rows this request claims.
// Listing the funds source is an audit requirement, not a convenience - finance
// has to be able to verify where the money came from (design doc 10.2).
func AdminGetWithdrawalDetail(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	withdrawal, err := model.GetWithdrawalById(id)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	commissions, err := model.GetWithdrawalCommissions(withdrawal.Id)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	// The snapshot is stored as JSON text. Decoding it here saves the console a
	// second parse; a snapshot written by an older schema is passed through as the
	// raw string instead of failing the whole detail view.
	payee := map[string]any{}
	if withdrawal.ProfileSnapshot != "" {
		if err := common.UnmarshalJsonStr(withdrawal.ProfileSnapshot, &payee); err != nil {
			common.SysError("failed to decode withdrawal profile snapshot: " + err.Error())
			payee = nil
		}
	}
	common.ApiSuccess(c, gin.H{
		"withdrawal":  withdrawal,
		"payee":       payee,
		"commissions": commissions,
	})
}

// AdminApproveWithdrawal moves a bank payout into the finance queue. The claimed
// commission rows stay frozen until the payment is marked complete.
func AdminApproveWithdrawal(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	if err := model.AuditWithdrawal(id, c.GetInt("id"), true, ""); err != nil {
		respondAgentError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type AdminWithdrawalReasonRequest struct {
	Reason string `json:"reason"`
}

// readWithdrawalReason validates the mandatory reason shared by the reject and
// fail actions. Both unfreeze the agent's commission, and an unexplained refusal
// is what turns into a dispute later.
func readWithdrawalReason(c *gin.Context) (string, bool) {
	var req AdminWithdrawalReasonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return "", false
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		common.ApiErrorMsg(c, "请填写原因")
		return "", false
	}
	if len([]rune(reason)) > 255 {
		common.ApiErrorMsg(c, "原因长度不能超过 255 个字符")
		return "", false
	}
	return reason, true
}

// AdminRejectWithdrawal refuses a payout and unfreezes the claimed commission.
func AdminRejectWithdrawal(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	reason, ok := readWithdrawalReason(c)
	if !ok {
		return
	}
	if err := model.AuditWithdrawal(id, c.GetInt("id"), false, reason); err != nil {
		respondAgentError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type AdminCompleteWithdrawalRequest struct {
	Voucher string `json:"voucher"`
}

// AdminCompleteWithdrawal records that money actually left the account. The
// voucher is mandatory and the action is audited: this is the point where the
// platform claims a payout happened, and without a reference number and a trace
// of who pressed the button a dispute cannot be settled (design doc 13.4).
func AdminCompleteWithdrawal(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminCompleteWithdrawalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	voucher := strings.TrimSpace(req.Voucher)
	if voucher == "" {
		common.ApiErrorMsg(c, "请填写打款凭证号")
		return
	}
	if len([]rune(voucher)) > 255 {
		common.ApiErrorMsg(c, "凭证号长度不能超过 255 个字符")
		return
	}

	withdrawal, err := model.GetWithdrawalById(id)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	if err := model.CompleteWithdrawal(id, c.GetInt("id"), voucher); err != nil {
		respondAgentError(c, err)
		return
	}
	recordManageAuditFor(c, withdrawal.AgentUserId, "agent.withdrawal_complete", map[string]interface{}{
		"withdrawal_id": withdrawal.Id,
		"amount":        withdrawal.Amount,
		"actual_amount": withdrawal.ActualAmount,
		"method":        withdrawal.Method,
		"from_status":   withdrawal.Status,
		"to_status":     model.WithdrawalStatusPaid,
		"voucher":       voucher,
	})
	common.ApiSuccess(c, nil)
}

// AdminFailWithdrawal records a failed bank transfer and unfreezes the commission
// so the agent can request the payout again.
func AdminFailWithdrawal(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	reason, ok := readWithdrawalReason(c)
	if !ok {
		return
	}
	if err := model.FailWithdrawal(id, c.GetInt("id"), reason); err != nil {
		respondAgentError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- Admin APIs: commissions ----

// AdminGetCommissions lists the platform-wide ledger for reconciliation.
// agent_user_id == 0 means "every agent".
func AdminGetCommissions(c *gin.Context) {
	agentUserId, _ := strconv.Atoi(c.Query("agent_user_id"))
	pageInfo := common.GetPageQuery(c)
	commissions, total, err := model.GetAgentCommissions(agentUserId, agentCommissionFilters(c), pageInfo)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(commissions)
	common.ApiSuccess(c, pageInfo)
}

// agentAdjustMaxAmount bounds a manual ledger correction. The amount is operator
// input that becomes a balance, so it needs a ceiling for the same reason the
// withdrawal amount does.
const agentAdjustMaxAmount = 1000000.0

type AdminAdjustCommissionRequest struct {
	AgentUserId int     `json:"agent_user_id"`
	Amount      float64 `json:"amount"`
	Reason      string  `json:"reason"`
}

// AdminAdjustCommission appends a positive or negative correction row. The ledger
// is append-only, so an adjustment is a new row and never an edit of history; the
// reason and the operator are recorded because this is money created by hand.
func AdminAdjustCommission(c *gin.Context) {
	var req AdminAdjustCommissionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if req.AgentUserId <= 0 {
		common.ApiErrorMsg(c, "请选择代理商")
		return
	}
	if math.IsNaN(req.Amount) || math.IsInf(req.Amount, 0) || req.Amount == 0 {
		common.ApiErrorMsg(c, "调整金额无效")
		return
	}
	if math.Abs(req.Amount) > agentAdjustMaxAmount {
		common.ApiErrorMsg(c, fmt.Sprintf("单次调整金额不能超过 %g 元", agentAdjustMaxAmount))
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		common.ApiErrorMsg(c, "请填写调整原因")
		return
	}
	if len([]rune(reason)) > 255 {
		common.ApiErrorMsg(c, "调整原因长度不能超过 255 个字符")
		return
	}

	if err := model.AdjustCommission(req.AgentUserId, req.Amount, c.GetInt("id"), reason); err != nil {
		respondAgentError(c, err)
		return
	}
	recordManageAuditFor(c, req.AgentUserId, "agent.commission_adjust", map[string]interface{}{
		"amount": req.Amount,
		"reason": reason,
	})
	common.ApiSuccess(c, nil)
}

// ---- Admin APIs: analytics ----

// agentAnalyticsAgentLimit bounds the per-agent breakdown. Design doc 11.5 puts
// the agent population in the hundreds, so this is headroom rather than a real
// constraint - but the table is rendered in one response, so it needs a ceiling.
const agentAnalyticsAgentLimit = 2000

// agentActiveWindowDays defines "active": an agent with at least one commission
// row in this many days (design doc 11.2).
const agentActiveWindowDays = 30

// AgentAnalyticsRow is one line of the per-agent breakdown.
type AgentAnalyticsRow struct {
	UserId   int    `json:"user_id"`
	Username string `json:"username"`
	Status   string `json:"status"`
	// Rate is the effective rate, already resolved against the global default.
	Rate float64 `json:"rate"`

	Customers          int64   `json:"customers"`
	PayingCustomers    int64   `json:"paying_customers"`
	PayingRate         float64 `json:"paying_rate"`
	Revenue            float64 `json:"revenue"`
	RevenuePerCustomer float64 `json:"avg_revenue_per_customer"`
	Commission         float64 `json:"commission"`
	EffectiveRate      float64 `json:"effective_rate"`

	FirstCommissionTime int64 `json:"first_commission_time"`
	LastCommissionTime  int64 `json:"last_commission_time"`
}

// safeRatio divides only when the denominator is meaningful. Every rate on the
// analytics page is a quotient of two aggregates, and an empty window makes the
// denominator zero.
func safeRatio(numerator float64, denominator float64) float64 {
	if denominator <= 0 {
		return 0
	}
	return numerator / denominator
}

// AdminGetAgentAnalytics assembles the whole analytics page in one response:
// overview metrics, the platform daily trend, and the per-agent breakdown.
//
// Money aggregates are windowed (default 30 days, 12 months max); population
// counts - agents, customers, pending payout - are all-time, because "how many
// agents do we have" is not a windowed question. The response labels which is
// which so the console does not have to guess.
func AdminGetAgentAnalytics(c *gin.Context) {
	start, end, err := agentStatsWindow(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	startTs, endTs := start.Unix(), end.Unix()

	// Agent population by status.
	type statusCount struct {
		Status string
		Total  int64
	}
	statusCounts := make([]statusCount, 0)
	if err := model.DB.Model(&model.AgentProfile{}).
		Select("status, COUNT(*) AS total").Group("status").
		Find(&statusCounts).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	agentsByStatus := map[string]int64{}
	var agentTotal int64
	for _, row := range statusCounts {
		agentsByStatus[row.Status] = row.Total
		agentTotal += row.Total
	}

	activeSince := time.Now().AddDate(0, 0, -agentActiveWindowDays).Unix()
	var activeAgents int64
	if err := model.DB.Model(&model.AgentCommission{}).
		Where("create_time >= ?", activeSince).
		Distinct("agent_user_id").Count(&activeAgents).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	var customerTotal int64
	if err := model.DB.Model(&model.User{}).Where("inviter_id > 0").Count(&customerTotal).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	// Ledger totals for the window. Reversals are negative rows, so a plain SUM
	// nets a refunded top-up out of both revenue and commission.
	type ledgerTotals struct {
		Revenue         float64
		Commission      float64
		PayingCustomers int64
	}
	var totals ledgerTotals
	if err := model.DB.Model(&model.AgentCommission{}).
		Select("COALESCE(SUM(base_amount), 0) AS revenue, COALESCE(SUM(amount), 0) AS commission, "+
			"COUNT(DISTINCT CASE WHEN base_amount > 0 THEN from_user_id END) AS paying_customers").
		Where("create_time >= ? AND create_time < ?", startTs, endTs).
		Scan(&totals).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	// Pending payout is deliberately not windowed: it is a liability that exists
	// now regardless of when the commission was earned.
	var pendingPayout float64
	if err := model.DB.Model(&model.AgentCommission{}).
		Select("COALESCE(SUM(amount), 0)").
		Where("status IN ?", []string{model.CommissionStatusSettled, model.CommissionStatusFrozen}).
		Scan(&pendingPayout).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	trend, truncated, err := agentDailyBuckets(0, start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	rows, err := agentAnalyticsBreakdown(startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"window": gin.H{
			"start_date": start.Format("2006-01-02"),
			"end_date":   end.AddDate(0, 0, -1).Format("2006-01-02"),
		},
		"overview": gin.H{
			"agent_total":      agentTotal,
			"agent_active":     activeAgents,
			"agents_by_status": agentsByStatus,
			"customer_total":   customerTotal,
			"paying_customers": totals.PayingCustomers,
			"paying_rate":      safeRatio(float64(totals.PayingCustomers), float64(customerTotal)),
			"promoted_revenue": totals.Revenue,
			"commission_paid":  totals.Commission,
			// The effective rate is the number that matters: it is the real cost and
			// drifts away from the nominal default as high-rate agents take a larger
			// share of the revenue (design doc 11.2).
			"effective_rate": safeRatio(totals.Commission, totals.Revenue),
			"pending_payout": pendingPayout,
		},
		"trend":     trend,
		"agents":    rows,
		"truncated": truncated || len(rows) >= agentAnalyticsAgentLimit,
	})
}

// agentAnalyticsBreakdown computes the per-agent performance table: three grouped
// queries merged in Go rather than one join, so no dialect-specific outer-join
// aggregation is needed and each part stays independently bounded.
//
// Customer counts are all-time while money is windowed: an agent's book of
// customers is a lasting relationship, whereas revenue is what they produced in
// the period under review.
func agentAnalyticsBreakdown(startTs int64, endTs int64) ([]*AgentAnalyticsRow, error) {
	type profileRow struct {
		UserId         int
		Username       string
		Status         string
		CommissionRate *float64
	}
	profiles := make([]profileRow, 0)
	if err := model.DB.Model(&model.AgentProfile{}).
		Select("agent_profiles.user_id, agent_profiles.status, agent_profiles.commission_rate, " +
			"COALESCE(users.username, '') AS username").
		Joins("LEFT JOIN users ON users.id = agent_profiles.user_id").
		Order("agent_profiles.user_id asc").
		Limit(agentAnalyticsAgentLimit).
		Find(&profiles).Error; err != nil {
		return nil, err
	}
	if len(profiles) == 0 {
		return []*AgentAnalyticsRow{}, nil
	}

	userIds := make([]int, 0, len(profiles))
	for _, profile := range profiles {
		userIds = append(userIds, profile.UserId)
	}

	type ledgerGroup struct {
		AgentUserId     int
		Revenue         float64
		Commission      float64
		PayingCustomers int64
		FirstTime       int64
		LastTime        int64
	}
	ledgerGroups := make([]ledgerGroup, 0)
	if err := model.DB.Model(&model.AgentCommission{}).
		Select("agent_user_id, COALESCE(SUM(base_amount), 0) AS revenue, COALESCE(SUM(amount), 0) AS commission, "+
			"COUNT(DISTINCT CASE WHEN base_amount > 0 THEN from_user_id END) AS paying_customers, "+
			"COALESCE(MIN(create_time), 0) AS first_time, COALESCE(MAX(create_time), 0) AS last_time").
		Where("agent_user_id IN ?", userIds).
		Where("create_time >= ? AND create_time < ?", startTs, endTs).
		Group("agent_user_id").
		Find(&ledgerGroups).Error; err != nil {
		return nil, err
	}
	ledgerByAgent := make(map[int]ledgerGroup, len(ledgerGroups))
	for _, group := range ledgerGroups {
		ledgerByAgent[group.AgentUserId] = group
	}

	type customerGroup struct {
		InviterId int
		Total     int64
	}
	customerGroups := make([]customerGroup, 0)
	if err := model.DB.Model(&model.User{}).
		Select("inviter_id, COUNT(*) AS total").
		Where("inviter_id IN ?", userIds).
		Group("inviter_id").
		Find(&customerGroups).Error; err != nil {
		return nil, err
	}
	customersByAgent := make(map[int]int64, len(customerGroups))
	for _, group := range customerGroups {
		customersByAgent[group.InviterId] = group.Total
	}

	rows := make([]*AgentAnalyticsRow, 0, len(profiles))
	for _, profile := range profiles {
		ledger := ledgerByAgent[profile.UserId]
		customers := customersByAgent[profile.UserId]
		rows = append(rows, &AgentAnalyticsRow{
			UserId:              profile.UserId,
			Username:            profile.Username,
			Status:              profile.Status,
			Rate:                setting.EffectiveCommissionRate(profile.CommissionRate),
			Customers:           customers,
			PayingCustomers:     ledger.PayingCustomers,
			PayingRate:          safeRatio(float64(ledger.PayingCustomers), float64(customers)),
			Revenue:             ledger.Revenue,
			RevenuePerCustomer:  safeRatio(ledger.Revenue, float64(customers)),
			Commission:          ledger.Commission,
			EffectiveRate:       safeRatio(ledger.Commission, ledger.Revenue),
			FirstCommissionTime: ledger.FirstTime,
			LastCommissionTime:  ledger.LastTime,
		})
	}
	return rows, nil
}

// ---- Admin APIs: export ----

// agentAdminExportLimit bounds one admin CSV export.
const agentAdminExportLimit = 10000

// writeAgentCsv streams a prepared table as CSV. Every cell is passed through
// csvSafeCell by the caller; this only handles the framing.
func writeAgentCsv(c *gin.Context, name string, header []string, records [][]string) {
	filename := fmt.Sprintf("agent-%s-%s.csv", name, time.Now().Format("20060102-150405"))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename="+filename)
	// Excel assumes the system codepage without a BOM, which renders Chinese as
	// mojibake.
	if _, err := c.Writer.WriteString("\xEF\xBB\xBF"); err != nil {
		common.SysError("failed to write agent csv bom: " + err.Error())
		return
	}
	writer := csv.NewWriter(c.Writer)
	if err := writer.Write(header); err != nil {
		common.SysError("failed to write agent csv header: " + err.Error())
		return
	}
	for _, record := range records {
		if err := writer.Write(record); err != nil {
			common.SysError("failed to write agent csv row: " + err.Error())
			return
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		common.SysError("failed to flush agent csv: " + err.Error())
	}
}

// AdminExportAgents exports agents, withdrawals or commissions as CSV. Bank
// accounts are masked in every export: a spreadsheet leaves the console and ends
// up in mail and file shares, so design doc 13.3 keeps full accounts on screen
// only.
func AdminExportAgents(c *gin.Context) {
	pageInfo := &common.PageInfo{Page: 1, PageSize: agentAdminExportLimit}

	switch c.Query("type") {
	case "withdrawals":
		agentUserId, _ := strconv.Atoi(c.Query("agent_user_id"))
		withdrawals, _, err := model.GetWithdrawals(agentUserId, c.Query("status"), c.Query("method"), pageInfo)
		if err != nil {
			respondAgentError(c, err)
			return
		}
		records := make([][]string, 0, len(withdrawals))
		for _, withdrawal := range withdrawals {
			records = append(records, []string{
				strconv.Itoa(withdrawal.Id),
				strconv.Itoa(withdrawal.AgentUserId),
				csvSafeCell(withdrawal.Username),
				strconv.FormatFloat(withdrawal.Amount, 'f', 2, 64),
				strconv.FormatFloat(withdrawal.Fee, 'f', 2, 64),
				strconv.FormatFloat(withdrawal.ActualAmount, 'f', 2, 64),
				csvSafeCell(withdrawal.Method),
				csvSafeCell(withdrawal.Status),
				csvSafeCell(withdrawal.PayVoucher),
				time.Unix(withdrawal.CreateTime, 0).Format("2006-01-02 15:04:05"),
				agentFormatTime(withdrawal.PayTime),
			})
		}
		writeAgentCsv(c, "withdrawals",
			[]string{"提现单号", "代理商ID", "代理商", "申请金额", "手续费", "实际到手", "出口方式", "状态", "打款凭证", "提交时间", "打款时间"},
			records)

	case "commissions":
		agentUserId, _ := strconv.Atoi(c.Query("agent_user_id"))
		commissions, _, err := model.GetAgentCommissions(agentUserId, agentCommissionFilters(c), pageInfo)
		if err != nil {
			respondAgentError(c, err)
			return
		}
		records := make([][]string, 0, len(commissions))
		for _, commission := range commissions {
			records = append(records, []string{
				strconv.Itoa(commission.Id),
				strconv.Itoa(commission.AgentUserId),
				strconv.Itoa(commission.FromUserId),
				csvSafeCell(commission.SourceType),
				strconv.Itoa(commission.SourceId),
				strconv.FormatFloat(commission.BaseAmount, 'f', 2, 64),
				strconv.FormatFloat(commission.Rate, 'f', 4, 64),
				strconv.FormatFloat(commission.Amount, 'f', 2, 64),
				csvSafeCell(commission.Status),
				csvSafeCell(commission.Remark),
				time.Unix(commission.CreateTime, 0).Format("2006-01-02 15:04:05"),
			})
		}
		writeAgentCsv(c, "commissions",
			[]string{"流水ID", "代理商ID", "来源客户ID", "来源类型", "来源单号", "计佣基数", "比例", "佣金金额", "状态", "备注", "时间"},
			records)

	default:
		profiles, _, err := model.GetAgentProfiles(c.Query("status"), c.Query("keyword"), pageInfo)
		if err != nil {
			respondAgentError(c, err)
			return
		}
		records := make([][]string, 0, len(profiles))
		for _, profile := range profiles {
			records = append(records, []string{
				strconv.Itoa(profile.UserId),
				csvSafeCell(profile.Username),
				csvSafeCell(profile.AgentType),
				csvSafeCell(profile.Status),
				csvSafeCell(profile.SubjectName),
				csvSafeCell(profile.CompanyName),
				csvSafeCell(profile.TaxNo),
				csvSafeCell(profile.BankName),
				// Masked, not omitted: finance still needs the last 4 digits to
				// match a payment against an agent.
				csvSafeCell(maskBankAccount(profile.BankAccount)),
				strconv.FormatFloat(setting.EffectiveCommissionRate(profile.CommissionRate), 'f', 4, 64),
				csvSafeCell(profile.ContactName),
				time.Unix(profile.CreatedAt, 0).Format("2006-01-02 15:04:05"),
			})
		}
		writeAgentCsv(c, "profiles",
			[]string{"用户ID", "用户名", "主体类型", "状态", "主体名称", "公司名称", "纳税人识别号", "开户行", "银行账号", "生效比例", "联系人", "创建时间"},
			records)
	}
}

// agentFormatTime renders an optional timestamp; an unset column stays empty
// instead of printing the 1970 epoch.
func agentFormatTime(ts int64) string {
	if ts <= 0 {
		return ""
	}
	return time.Unix(ts, 0).Format("2006-01-02 15:04:05")
}
