package controller

import (
	"encoding/csv"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// respondAgentError maps the ledger and withdrawal sentinel errors onto wording
// an agent can act on. Anything unrecognised is reported generically so a driver
// or constraint message never reaches the browser.
func respondAgentError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrAgentProfileNotFound):
		common.ApiErrorMsg(c, "代理信息不存在")
	case errors.Is(err, model.ErrAgentProfileNotActive):
		common.ApiErrorMsg(c, "当前代理身份信息待补充或未审核通过，请先补充资料并等待审核")
	case errors.Is(err, model.ErrAgentStatusInvalid):
		common.ApiErrorMsg(c, "当前状态不允许该操作，请刷新后重试")
	case errors.Is(err, model.ErrAgentRateInvalid):
		common.ApiErrorMsg(c, "分佣比例无效")
	case errors.Is(err, model.ErrAgentSubjectIncomplete):
		common.ApiErrorMsg(c, "主体信息不完整，请补全后再提交")
	case errors.Is(err, model.ErrAgentReasonRequired):
		common.ApiErrorMsg(c, "请填写原因")
	case errors.Is(err, model.ErrAgentSelfReferral):
		common.ApiErrorMsg(c, "不能将自己作为下级客户")
	case errors.Is(err, model.ErrCommissionInsufficient):
		common.ApiErrorMsg(c, "可提现佣金不足，请刷新后重试")
	case errors.Is(err, model.ErrWithdrawalNotFound):
		common.ApiErrorMsg(c, "提现申请不存在")
	case errors.Is(err, model.ErrWithdrawalStatusInvalid):
		common.ApiErrorMsg(c, "提现单当前状态不允许该操作，请刷新后重试")
	case errors.Is(err, model.ErrWithdrawalInFlight):
		common.ApiErrorMsg(c, "已有一笔提现申请在审核中，请等待处理完成")
	case errors.Is(err, model.ErrWithdrawalBelowMinimum):
		common.ApiErrorMsg(c, fmt.Sprintf("提现金额不能低于 %g 元", setting.AgentMinWithdrawal))
	case errors.Is(err, model.ErrWithdrawalBankIncomplete):
		common.ApiErrorMsg(c, "银行提现需要先补全开户行、银行账号与主体名称")
	case errors.Is(err, model.ErrWithdrawalAmountInvalid):
		common.ApiErrorMsg(c, "提现金额无效")
	default:
		common.ApiError(c, err)
	}
}

// requireAgentProgramme rejects agent-side traffic while the programme is off.
// The switch has to be enforced here and not only in the UI: a stale browser tab
// or a scripted client would otherwise keep submitting withdrawals after the
// operator shut the programme down.
func requireAgentProgramme(c *gin.Context) bool {
	if setting.AgentEnabled {
		return true
	}
	common.ApiErrorMsg(c, "代理分销功能未开启")
	return false
}

// maskBankAccount keeps only the trailing 4 digits. Design doc 13.3 requires the
// full account to appear in exactly one place - the admin withdrawal detail that
// finance pays from - so every other read path goes through this.
func maskBankAccount(account string) string {
	account = strings.TrimSpace(account)
	if account == "" {
		return ""
	}
	runes := []rune(account)
	if len(runes) <= 4 {
		return strings.Repeat("*", len(runes))
	}
	return strings.Repeat("*", len(runes)-4) + string(runes[len(runes)-4:])
}

// ---- Agent APIs: profile ----

// GetAgentProfile returns the workbench header: the caller's own profile, the
// earnings summary and the promotion links. EnsureAgentProfile is used so a
// first-time visitor gets a row instead of an error - promoting is allowed before
// the identity documents are submitted (design doc 4.2).
func GetAgentProfile(c *gin.Context) {
	if !requireAgentProgramme(c) {
		return
	}
	userId := c.GetInt("id")

	profile, err := model.EnsureAgentProfile(userId)
	if err != nil {
		respondAgentError(c, err)
		return
	}

	// The denormalized users columns are display-only and may lag behind the
	// ledger, so refresh them best-effort before reading. A failure here must not
	// fail the page: the withdrawable figure below is re-aggregated regardless.
	if err := model.RefreshAgentCommissionSummary(userId); err != nil {
		common.SysError("failed to refresh agent commission summary: " + err.Error())
	}
	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// available comes from the ledger, not from the summary column: it is the
	// number the withdrawal button acts on, and the server would reject a stale
	// value anyway.
	available, err := model.SumWithdrawableCommission(userId)
	if err != nil {
		respondAgentError(c, err)
		return
	}

	// Counting users.inviter_id rather than reading users.aff_count: aff_count is
	// only incremented at registration and never decremented, so it drifts once
	// an invited account is deleted.
	var customerCount int64
	if err := model.DB.Model(&model.User{}).Where("inviter_id = ?", userId).Count(&customerCount).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	if user.AffCode == "" {
		// Same backfill as GetAffCode: an agent that registered before aff codes
		// existed still needs a promotion link.
		user.AffCode = common.GetRandomString(4)
		if err := user.Update(false); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	base := strings.TrimRight(system_setting.ServerAddress, "/")
	// The response profile is a copy of the row: masking the field on the loaded
	// struct is what keeps the full account out of the JSON.
	masked := *profile
	masked.BankAccount = maskBankAccount(profile.BankAccount)
	// Remark is the operators' internal note about this agent (design doc 4.2)
	// and is never shown to the agent.
	masked.Remark = ""

	common.ApiSuccess(c, gin.H{
		"profile":        masked,
		"effective_rate": setting.EffectiveCommissionRate(profile.CommissionRate),
		"stats": gin.H{
			"available":      available,
			"total":          user.AgentCommissionTotal,
			"withdrawn":      user.AgentWithdrawnTotal,
			"customer_count": customerCount,
		},
		"aff_code":      user.AffCode,
		"promo_link":    base + "/r/" + user.AffCode,
		"register_link": base + "/register?aff=" + url.QueryEscape(user.AffCode),
		"withdrawal": gin.H{
			"min_amount": setting.AgentMinWithdrawal,
			"fee_rate":   setting.AgentWithdrawalFeeRate,
			"can_apply":  profile.Status == model.AgentStatusActive,
		},
	})
}

// SubmitAgentProfileRequest is the client-writable part of a profile. The model
// struct is deliberately not bound: a client must not be able to set Id, UserId,
// Status, CommissionRate or the audit fields.
type SubmitAgentProfileRequest struct {
	AgentType    string `json:"agent_type"`
	SubjectName  string `json:"subject_name"`
	IdNo         string `json:"id_no"`
	CompanyName  string `json:"company_name"`
	TaxNo        string `json:"tax_no"`
	BankName     string `json:"bank_name"`
	BankAccount  string `json:"bank_account"`
	BankBranch   string `json:"bank_branch"`
	ContactName  string `json:"contact_name"`
	ContactPhone string `json:"contact_phone"`
	ContactEmail string `json:"contact_email"`
}

// SubmitAgentProfile stores the subject and payee details and moves the profile
// into the review queue.
func SubmitAgentProfile(c *gin.Context) {
	if !requireAgentProgramme(c) {
		return
	}
	var req SubmitAgentProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	params := model.SubmitAgentProfileParams{
		AgentType:    strings.TrimSpace(req.AgentType),
		SubjectName:  strings.TrimSpace(req.SubjectName),
		IdNo:         strings.TrimSpace(req.IdNo),
		CompanyName:  strings.TrimSpace(req.CompanyName),
		TaxNo:        strings.TrimSpace(req.TaxNo),
		BankName:     strings.TrimSpace(req.BankName),
		BankAccount:  strings.TrimSpace(req.BankAccount),
		BankBranch:   strings.TrimSpace(req.BankBranch),
		ContactName:  strings.TrimSpace(req.ContactName),
		ContactPhone: strings.TrimSpace(req.ContactPhone),
		ContactEmail: strings.TrimSpace(req.ContactEmail),
	}
	if params.AgentType == "" {
		params.AgentType = model.AgentTypePersonal
	}
	if params.AgentType != model.AgentTypePersonal && params.AgentType != model.AgentTypeCompany {
		common.ApiErrorMsg(c, "主体类型无效")
		return
	}
	if params.AgentType == model.AgentTypePersonal {
		if params.SubjectName == "" || params.IdNo == "" {
			common.ApiErrorMsg(c, "个人主体需要填写姓名与证件号")
			return
		}
	} else if params.CompanyName == "" || params.TaxNo == "" {
		common.ApiErrorMsg(c, "企业主体需要填写公司名称与纳税人识别号")
		return
	}
	// A half-filled payee block is worse than an empty one: finance would have an
	// account number with nowhere to send it.
	if (params.BankName != "") != (params.BankAccount != "") {
		common.ApiErrorMsg(c, "开户行与银行账号需要同时填写")
		return
	}
	// Field widths mirror the column definitions in model/agent.go; rejecting here
	// gives a readable message instead of a truncation or a driver error.
	for _, field := range []struct {
		name  string
		value string
		max   int
	}{
		{"姓名", params.SubjectName, 64},
		{"证件号", params.IdNo, 64},
		{"公司名称", params.CompanyName, 255},
		{"纳税人识别号", params.TaxNo, 64},
		{"开户行", params.BankName, 255},
		{"银行账号", params.BankAccount, 64},
		{"开户支行", params.BankBranch, 255},
		{"联系人", params.ContactName, 64},
		{"联系电话", params.ContactPhone, 32},
		{"联系邮箱", params.ContactEmail, 128},
	} {
		if len([]rune(field.value)) > field.max {
			common.ApiErrorMsg(c, fmt.Sprintf("%s长度不能超过 %d 个字符", field.name, field.max))
			return
		}
	}

	profile, err := model.SubmitAgentProfile(c.GetInt("id"), params)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	masked := *profile
	masked.BankAccount = maskBankAccount(profile.BankAccount)
	masked.Remark = ""
	common.ApiSuccess(c, masked)
}

// ---- Agent APIs: customers ----

// AgentCustomerRow is the complete set of customer columns an agent may see
// (design doc 13.2). It exists as a narrow struct on purpose: loading model.User
// and relying on JSON tags to hide email / phone / access_token would leak the
// next sensitive column somebody adds to that table. Anything not listed here is
// never selected from the database in the first place.
type AgentCustomerRow struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	CreatedAt   int64  `json:"created_at"`
	Quota       int    `json:"quota"`
	UsedQuota   int    `json:"used_quota"`
	Status      int    `json:"status"`
	// Field names have to match the SELECT aliases: GORM maps result columns by
	// field name and ignores the json tag, so a mismatch scans as zero.
	TopupTotal      float64 `json:"topup_total"`
	CommissionTotal float64 `json:"commission_total"`
}

// agentCustomerSortColumns whitelists what may reach the ORDER BY clause. The
// sort key arrives from the query string, so a whitelist is the only safe way to
// accept it.
var agentCustomerSortColumns = map[string]string{
	"id":               "users.id",
	"username":         "users.username",
	"created_at":       "users.created_at",
	"quota":            "users.quota",
	"used_quota":       "users.used_quota",
	"status":           "users.status",
	"topup_total":      "topup_total",
	"commission_total": "commission_total",
}

// agentCustomerQuery builds the customer query for one agent. Both the list and
// the CSV export go through it so the export can never widen the column set or
// escape the inviter_id filter.
//
// The per-customer top-up and commission totals come from the agent_commission
// ledger. Accumulated usage comes from users.used_quota and the logs table is not
// touched at all: logs is one of the largest tables in production and a GROUP BY
// over it inside a paginated request would take the database down (design doc 9.2).
func agentCustomerQuery(agentUserId int, keyword string) *gorm.DB {
	ledger := model.DB.Model(&model.AgentCommission{}).
		Select("from_user_id, SUM(base_amount) AS topup_total, SUM(amount) AS commission_total").
		Where("agent_user_id = ?", agentUserId).
		Group("from_user_id")

	return agentCustomerScope(agentUserId, keyword).
		Select("users.id, users.username, users.display_name, users.created_at, "+
			"users.quota, users.used_quota, users.status, "+
			"COALESCE(led.topup_total, 0) AS topup_total, "+
			"COALESCE(led.commission_total, 0) AS commission_total").
		Joins("LEFT JOIN (?) AS led ON led.from_user_id = users.id", ledger)
}

// agentCustomerScope is the row filter shared by the list, the export and the
// count: inviter_id plus the optional keyword. The count uses it without the
// ledger join, because the keyword only ever matches user columns and computing
// the per-customer aggregates to throw them away is wasted work.
func agentCustomerScope(agentUserId int, keyword string) *gorm.DB {
	query := model.DB.Model(&model.User{}).Where("users.inviter_id = ?", agentUserId)

	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return query
	}
	// Only username and display_name are searchable. Matching on email or phone
	// would turn this endpoint into a lookup oracle for contact details the agent
	// is not allowed to see.
	escaped := strings.ReplaceAll(keyword, "!", "!!")
	escaped = strings.ReplaceAll(escaped, "%", "!%")
	escaped = strings.ReplaceAll(escaped, "_", "!_")
	pattern := "%" + escaped + "%"
	return query.Where("(users.username LIKE ? ESCAPE '!' OR users.display_name LIKE ? ESCAPE '!')", pattern, pattern)
}

// agentCustomerOrder resolves the requested sort into a safe ORDER BY clause.
func agentCustomerOrder(sortBy string, order string) string {
	column, ok := agentCustomerSortColumns[sortBy]
	if !ok {
		column = "users.id"
	}
	if strings.EqualFold(order, "asc") {
		return column + " asc"
	}
	return column + " desc"
}

// GetAgentCustomers lists the users invited by the caller. The agent id comes
// from the auth context only - accepting it from the request would let any agent
// read another agent's customer book.
func GetAgentCustomers(c *gin.Context) {
	if !requireAgentProgramme(c) {
		return
	}
	userId := c.GetInt("id")
	keyword := c.Query("keyword")
	pageInfo := common.GetPageQuery(c)

	var total int64
	if err := agentCustomerScope(userId, keyword).Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	rows := make([]*AgentCustomerRow, 0)
	err := agentCustomerQuery(userId, keyword).
		Order(agentCustomerOrder(c.Query("sort_by"), c.Query("order"))).
		Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).
		Find(&rows).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(rows)
	common.ApiSuccess(c, pageInfo)
}

// agentCustomerExportLimit bounds one CSV export. An agent's customer book is far
// smaller than this in practice; the cap only keeps the response finite.
const agentCustomerExportLimit = 10000

// GetAgentCustomersExport writes the customer list as CSV. It reuses
// agentCustomerQuery, so the export is bound by the same column whitelist and the
// same inviter_id filter as the list endpoint.
func GetAgentCustomersExport(c *gin.Context) {
	if !requireAgentProgramme(c) {
		return
	}
	userId := c.GetInt("id")

	rows := make([]*AgentCustomerRow, 0)
	err := agentCustomerQuery(userId, c.Query("keyword")).
		Order(agentCustomerOrder(c.Query("sort_by"), c.Query("order"))).
		Limit(agentCustomerExportLimit).
		Find(&rows).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}

	filename := fmt.Sprintf("agent-customers-%s.csv", time.Now().Format("20060102-150405"))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename="+filename)
	// Excel assumes the system codepage without a BOM, which renders Chinese as
	// mojibake.
	if _, err := c.Writer.WriteString("\xEF\xBB\xBF"); err != nil {
		common.SysError("failed to write agent customer csv bom: " + err.Error())
		return
	}

	writer := csv.NewWriter(c.Writer)
	header := []string{"用户ID", "用户名", "显示名", "邀请时间", "累计充值", "剩余额度", "累计用量", "累计佣金", "状态"}
	if err := writer.Write(header); err != nil {
		common.SysError("failed to write agent customer csv header: " + err.Error())
		return
	}
	for _, row := range rows {
		record := []string{
			strconv.Itoa(row.Id),
			// csvSafeCell neutralises spreadsheet formula injection: a username is
			// user-supplied text and Excel evaluates a cell starting with = + - @.
			csvSafeCell(row.Username),
			csvSafeCell(row.DisplayName),
			time.Unix(row.CreatedAt, 0).Format("2006-01-02 15:04:05"),
			strconv.FormatFloat(row.TopupTotal, 'f', 2, 64),
			strconv.Itoa(row.Quota),
			strconv.Itoa(row.UsedQuota),
			strconv.FormatFloat(row.CommissionTotal, 'f', 2, 64),
			strconv.Itoa(row.Status),
		}
		if err := writer.Write(record); err != nil {
			common.SysError("failed to write agent customer csv row: " + err.Error())
			return
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		common.SysError("failed to flush agent customer csv: " + err.Error())
	}
}

// ---- Agent APIs: commissions and stats ----

// agentCommissionFilters reads the shared ledger filters from the query string.
// The agent scope is never taken from here; the caller passes it separately.
func agentCommissionFilters(c *gin.Context) model.CommissionFilters {
	fromUserId, _ := strconv.Atoi(c.Query("from_user_id"))
	startTime, _ := strconv.ParseInt(c.Query("start_time"), 10, 64)
	endTime, _ := strconv.ParseInt(c.Query("end_time"), 10, 64)
	filters := model.CommissionFilters{
		Status:     c.Query("status"),
		SourceType: c.Query("source_type"),
		FromUserId: fromUserId,
		StartTime:  startTime,
		EndTime:    endTime,
	}
	// The bounds are pointers so an absent parameter stays absent: a reversal row
	// is negative, so a zero-valued "min" would silently hide corrections.
	if raw := strings.TrimSpace(c.Query("min_amount")); raw != "" {
		if value, err := strconv.ParseFloat(raw, 64); err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) {
			filters.MinAmount = &value
		}
	}
	if raw := strings.TrimSpace(c.Query("max_amount")); raw != "" {
		if value, err := strconv.ParseFloat(raw, 64); err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) {
			filters.MaxAmount = &value
		}
	}
	return filters
}

// GetAgentCommissions lists the caller's own commission ledger.
func GetAgentCommissions(c *gin.Context) {
	if !requireAgentProgramme(c) {
		return
	}
	pageInfo := common.GetPageQuery(c)
	// The agent scope is the authenticated id; from_user_id in the filters only
	// narrows within rows that already belong to this agent.
	commissions, total, err := model.GetAgentCommissions(c.GetInt("id"), agentCommissionFilters(c), pageInfo)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(commissions)
	common.ApiSuccess(c, pageInfo)
}

const (
	agentStatsDefaultDays = 30
	// agentStatsMaxDays caps every aggregation window at 12 months (design doc
	// 11.5). Unbounded windows are rejected rather than silently clamped so a
	// caller never believes it received a full history.
	agentStatsMaxDays = 366
	// agentStatsRowLimit bounds how many ledger / user rows one aggregation may
	// scan. Bucketing happens in Go because the three supported databases have
	// incompatible date functions, so the row count has to be capped explicitly.
	agentStatsRowLimit = 200000
)

// agentStatsWindow resolves the requested window into a [start, end) range of
// whole local days. An explicit range wider than the cap is an error, not a
// clamp: the caller asked for data the endpoint refuses to compute.
func agentStatsWindow(c *gin.Context) (time.Time, time.Time, error) {
	now := time.Now()
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, 1)
	start := end.AddDate(0, 0, -agentStatsDefaultDays)

	if raw := strings.TrimSpace(c.Query("start_date")); raw != "" {
		parsed, err := time.ParseInLocation("2006-01-02", raw, time.Local)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("开始日期格式应为 YYYY-MM-DD")
		}
		start = parsed
	}
	if raw := strings.TrimSpace(c.Query("end_date")); raw != "" {
		parsed, err := time.ParseInLocation("2006-01-02", raw, time.Local)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("结束日期格式应为 YYYY-MM-DD")
		}
		end = parsed.AddDate(0, 0, 1)
	}
	if days, err := strconv.Atoi(strings.TrimSpace(c.Query("days"))); err == nil && days > 0 {
		start = end.AddDate(0, 0, -days)
	}

	if !start.Before(end) {
		return time.Time{}, time.Time{}, errors.New("开始日期必须早于结束日期")
	}
	if int(end.Sub(start).Hours()/24) > agentStatsMaxDays {
		return time.Time{}, time.Time{}, fmt.Errorf("查询区间不能超过 %d 天", agentStatsMaxDays)
	}
	return start, end, nil
}

// AgentDailyBucket is one point of the trend chart.
type AgentDailyBucket struct {
	Date         string  `json:"date"`
	NewCustomers int     `json:"new_customers"`
	TopupAmount  float64 `json:"topup_amount"`
	Commission   float64 `json:"commission"`
}

// agentDailyBuckets aggregates new customers and ledger money per day.
// agentUserId == 0 aggregates the whole platform for the admin analytics page.
//
// The rows are bucketed in Go rather than with a SQL date expression because
// SQLite, MySQL and PostgreSQL disagree on both date functions and integer
// division, and a dialect branch here would be three code paths to keep correct.
// The window cap plus agentStatsRowLimit is what keeps the scan bounded; design
// doc 11.5 replaces this with the pre-aggregated agent_daily_stat table in P2.
func agentDailyBuckets(agentUserId int, start time.Time, end time.Time) ([]*AgentDailyBucket, bool, error) {
	buckets := make([]*AgentDailyBucket, 0)
	index := map[string]*AgentDailyBucket{}
	for day := start; day.Before(end); day = day.AddDate(0, 0, 1) {
		bucket := &AgentDailyBucket{Date: day.Format("2006-01-02")}
		buckets = append(buckets, bucket)
		index[bucket.Date] = bucket
	}

	type ledgerRow struct {
		CreateTime int64
		BaseAmount float64
		Amount     float64
	}
	ledgerRows := make([]ledgerRow, 0)
	ledgerQuery := model.DB.Model(&model.AgentCommission{}).
		Select("create_time, base_amount, amount").
		Where("create_time >= ? AND create_time < ?", start.Unix(), end.Unix())
	if agentUserId > 0 {
		ledgerQuery = ledgerQuery.Where("agent_user_id = ?", agentUserId)
	}
	if err := ledgerQuery.Limit(agentStatsRowLimit + 1).Find(&ledgerRows).Error; err != nil {
		return nil, false, err
	}
	truncated := len(ledgerRows) > agentStatsRowLimit
	if truncated {
		ledgerRows = ledgerRows[:agentStatsRowLimit]
	}
	for _, row := range ledgerRows {
		bucket, ok := index[time.Unix(row.CreateTime, 0).Format("2006-01-02")]
		if !ok {
			continue
		}
		// Reversals are stored as negative rows, so a plain sum nets a refunded
		// top-up back out of both figures.
		bucket.TopupAmount += row.BaseAmount
		bucket.Commission += row.Amount
	}

	type customerRow struct {
		CreatedAt int64
	}
	customerRows := make([]customerRow, 0)
	customerQuery := model.DB.Model(&model.User{}).
		Select("created_at").
		Where("created_at >= ? AND created_at < ?", start.Unix(), end.Unix())
	if agentUserId > 0 {
		customerQuery = customerQuery.Where("inviter_id = ?", agentUserId)
	} else {
		customerQuery = customerQuery.Where("inviter_id > 0")
	}
	if err := customerQuery.Limit(agentStatsRowLimit + 1).Find(&customerRows).Error; err != nil {
		return nil, false, err
	}
	if len(customerRows) > agentStatsRowLimit {
		truncated = true
		customerRows = customerRows[:agentStatsRowLimit]
	}
	for _, row := range customerRows {
		if bucket, ok := index[time.Unix(row.CreatedAt, 0).Format("2006-01-02")]; ok {
			bucket.NewCustomers++
		}
	}
	return buckets, truncated, nil
}

// GetAgentStats returns the daily series behind the agent's earnings chart.
func GetAgentStats(c *gin.Context) {
	if !requireAgentProgramme(c) {
		return
	}
	start, end, err := agentStatsWindow(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	buckets, truncated, err := agentDailyBuckets(c.GetInt("id"), start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"start_date": start.Format("2006-01-02"),
		"end_date":   end.AddDate(0, 0, -1).Format("2006-01-02"),
		"daily":      buckets,
		"truncated":  truncated,
	})
}

// ---- Agent APIs: withdrawals ----

// agentWithdrawalMaxAmount is the hard ceiling on one withdrawal request. Per
// AGENTS.md every user-controlled quantity that becomes a billing multiplier has
// to be bounded before it reaches quota arithmetic; without this a JSON number
// like 1e30 would travel all the way into the ledger comparison.
const agentWithdrawalMaxAmount = 1000000.0

type CreateAgentWithdrawalRequest struct {
	Amount float64 `json:"amount"`
	Method string  `json:"method"`
}

// CreateAgentWithdrawal submits a payout request for the caller's own balance.
// The gate checks that matter for funds safety (active profile, single in-flight
// request, amount <= ledger balance under a row lock) live in the model; this
// handler only rejects input that must never reach the arithmetic.
func CreateAgentWithdrawal(c *gin.Context) {
	if !requireAgentProgramme(c) {
		return
	}
	var req CreateAgentWithdrawalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	method := strings.TrimSpace(req.Method)
	if method != model.WithdrawalMethodBalance && method != model.WithdrawalMethodBank {
		common.ApiErrorMsg(c, "提现出口无效")
		return
	}
	if math.IsNaN(req.Amount) || math.IsInf(req.Amount, 0) || req.Amount <= 0 {
		common.ApiErrorMsg(c, "提现金额无效")
		return
	}
	if req.Amount > agentWithdrawalMaxAmount {
		common.ApiErrorMsg(c, fmt.Sprintf("单笔提现金额不能超过 %g 元", agentWithdrawalMaxAmount))
		return
	}
	// The balance route converts the payout into quota, and quota columns are
	// 32-bit. Rejecting here means the agent is told to split the request instead
	// of having the credited amount silently clamped down while the commission is
	// marked paid in full.
	if method == model.WithdrawalMethodBalance && req.Amount*common.QuotaPerUnit > float64(math.MaxInt32) {
		common.ApiErrorMsg(c, "该金额超出余额出口上限，请改用银行提现或分次提现")
		return
	}

	withdrawal, err := model.CreateWithdrawal(model.CreateWithdrawalParams{
		UserId: c.GetInt("id"),
		Amount: req.Amount,
		Method: method,
	})
	if err != nil {
		respondAgentError(c, err)
		return
	}
	// ProfileSnapshot freezes the payee block, bank account included. The agent
	// already knows their own account, but 13.3 keeps the unmasked value to the
	// admin payout screen only, so it does not travel back here.
	withdrawal.ProfileSnapshot = ""
	common.ApiSuccess(c, withdrawal)
}

// GetAgentWithdrawals lists the caller's own payout requests.
func GetAgentWithdrawals(c *gin.Context) {
	if !requireAgentProgramme(c) {
		return
	}
	pageInfo := common.GetPageQuery(c)
	withdrawals, total, err := model.GetWithdrawals(c.GetInt("id"), c.Query("status"), c.Query("method"), pageInfo)
	if err != nil {
		respondAgentError(c, err)
		return
	}
	for _, withdrawal := range withdrawals {
		withdrawal.ProfileSnapshot = ""
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(withdrawals)
	common.ApiSuccess(c, pageInfo)
}

// CancelAgentWithdrawal withdraws a request that is still under review. The user
// id is passed to the model so the ownership check happens in the same query that
// finds the row - a cancel must not be able to target another agent's request.
func CancelAgentWithdrawal(c *gin.Context) {
	if !requireAgentProgramme(c) {
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	if err := model.CancelWithdrawal(id, c.GetInt("id")); err != nil {
		respondAgentError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- Anonymous: promotion short link ----

// AgentPromoCookie carries the referring aff code for visitors who land on the
// short link and register later in the same browser.
const AgentPromoCookie = "aff"

// agentPromoCookieMaxAge is the 30-day attribution window from design doc 7.2.
const agentPromoCookieMaxAge = 30 * 24 * 60 * 60

// AgentPromoRedirect resolves a short promotion link and sends the visitor to the
// register page. It is anonymous and the code space is enumerable, so it is rate
// limited at the route.
//
// An unresolvable code redirects to the plain register page instead of returning
// an error: a prospect who was handed a stale flyer should still be able to sign
// up, and a stack trace or a JSON error body is the worst possible first
// impression. It also keeps the endpoint from confirming which codes exist.
func AgentPromoRedirect(c *gin.Context) {
	// The redirect writes a cookie, so it must not be cached by the browser or by
	// an intermediary - the web router sets a one-week Cache-Control by default.
	c.Header("Cache-Control", "no-store")

	code := strings.TrimSpace(c.Param("code"))
	// aff codes are short alphanumeric strings (common.GetRandomString). Filtering
	// here keeps junk out of the lookup and out of the redirect target.
	valid := code != "" && len(code) <= 32
	if valid {
		for _, r := range code {
			if (r < '0' || r > '9') && (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') {
				valid = false
				break
			}
		}
	}
	if valid {
		if userId, err := model.GetUserIdByAffCode(code); err != nil || userId <= 0 {
			valid = false
		}
	}
	if !valid {
		c.Redirect(http.StatusFound, "/register")
		return
	}

	// Not HttpOnly on purpose: the register form reads the code from the browser
	// when the URL parameter is missing. SameSite=Lax is enough for a top-level
	// navigation and keeps the cookie off cross-site subrequests.
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(AgentPromoCookie, code, agentPromoCookieMaxAge, "/", "", common.SessionCookieSecure, false)
	c.Redirect(http.StatusFound, "/register?aff="+url.QueryEscape(code))
}
