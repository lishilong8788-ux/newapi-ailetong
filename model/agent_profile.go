package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"

	"gorm.io/gorm"
)

var (
	// ErrAgentSubjectIncomplete keeps unverifiable submissions out of the audit
	// queue: an operator cannot check a subject that has no name or registration
	// number, so the gap is reported back to the agent instead of to the reviewer.
	ErrAgentSubjectIncomplete = errors.New("agent subject details are incomplete")

	// ErrAgentReasonRequired covers every negative verdict and every manual money
	// adjustment. A refusal or a correction with no stated reason cannot be
	// explained back to the agent, and the design makes the reason part of the
	// audit record rather than an optional note.
	ErrAgentReasonRequired = errors.New("a reason is required")
)

// SubmitAgentProfileParams is the validated input for one subject submission.
type SubmitAgentProfileParams struct {
	AgentType string

	SubjectName string
	IdNo        string
	CompanyName string
	TaxNo       string

	BankName    string
	BankAccount string
	BankBranch  string

	ContactName  string
	ContactPhone string
	ContactEmail string
}

func GetAgentProfileByUserId(userId int) (*AgentProfile, error) {
	var profile AgentProfile
	if err := DB.Where("user_id = ?", userId).First(&profile).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAgentProfileNotFound
		}
		return nil, err
	}
	return &profile, nil
}

// EnsureAgentProfile returns the caller's profile, creating an incomplete one on
// first use. A user may promote and earn commission before submitting identity
// documents, so the row has to exist before anything has been audited.
//
// The uniqueIndex on user_id is the authority under concurrency: two callers can
// both find nothing and both insert, and the loser re-reads the winner's row
// rather than propagating a duplicate-key error to a caller that only asked for
// a profile.
func EnsureAgentProfile(userId int) (*AgentProfile, error) {
	if userId <= 0 {
		return nil, ErrAgentProfileNotFound
	}

	profile, err := GetAgentProfileByUserId(userId)
	if err == nil {
		return profile, nil
	}
	if !errors.Is(err, ErrAgentProfileNotFound) {
		return nil, err
	}

	created := &AgentProfile{
		UserId:    userId,
		AgentType: AgentTypePersonal,
		Status:    AgentStatusIncomplete,
	}
	if err := DB.Create(created).Error; err != nil {
		if isDuplicateKeyError(err) {
			return GetAgentProfileByUserId(userId)
		}
		return nil, err
	}
	return created, nil
}

// SubmitAgentProfile records a subject submission and puts it back in the audit
// queue. Editing an already-active profile returns it to pending: the payee and
// identity details are exactly what an operator signed off on, so a silent edit
// would leave an approved profile nobody approved.
func SubmitAgentProfile(userId int, params SubmitAgentProfileParams) (*AgentProfile, error) {
	agentType := AgentTypePersonal
	if params.AgentType == AgentTypeCompany {
		agentType = AgentTypeCompany
	}

	subjectName := strings.TrimSpace(params.SubjectName)
	idNo := strings.TrimSpace(params.IdNo)
	companyName := strings.TrimSpace(params.CompanyName)
	taxNo := strings.TrimSpace(params.TaxNo)

	// Only one branch of the subject fields is meaningful per type, and the other
	// is cleared rather than carried: a profile that switched from company to
	// personal must not keep a tax number the operator never verified.
	if agentType == AgentTypePersonal {
		if subjectName == "" || idNo == "" {
			return nil, ErrAgentSubjectIncomplete
		}
		companyName = ""
		taxNo = ""
	} else {
		if companyName == "" || taxNo == "" {
			return nil, ErrAgentSubjectIncomplete
		}
		subjectName = ""
		idNo = ""
	}

	if _, err := EnsureAgentProfile(userId); err != nil {
		return nil, err
	}

	targetStatus := AgentStatusPending
	auditTime := int64(0)
	if setting.AgentAutoApprove {
		targetStatus = AgentStatusActive
		auditTime = common.GetTimestamp()
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var current AgentProfile
		if err := lockForUpdate(tx).Where("user_id = ?", userId).First(&current).Error; err != nil {
			return ErrAgentProfileNotFound
		}
		// A suspended agent cannot lift their own suspension by resubmitting; only
		// an operator reactivates through SetAgentStatus.
		if current.Status == AgentStatusSuspended {
			return ErrAgentStatusInvalid
		}

		return tx.Model(&AgentProfile{}).Where("id = ?", current.Id).
			Updates(map[string]interface{}{
				"agent_type":    agentType,
				"status":        targetStatus,
				"subject_name":  subjectName,
				"id_no":         idNo,
				"company_name":  companyName,
				"tax_no":        taxNo,
				"bank_name":     strings.TrimSpace(params.BankName),
				"bank_account":  strings.TrimSpace(params.BankAccount),
				"bank_branch":   strings.TrimSpace(params.BankBranch),
				"contact_name":  strings.TrimSpace(params.ContactName),
				"contact_phone": strings.TrimSpace(params.ContactPhone),
				"contact_email": strings.TrimSpace(params.ContactEmail),
				// A resubmission is a fresh review: the previous verdict and its
				// reason would otherwise stay on screen next to pending status.
				"reject_reason": "",
				"audit_by":      0,
				"audit_time":    auditTime,
			}).Error
	})
	if err != nil {
		return nil, err
	}

	return GetAgentProfileByUserId(userId)
}

// AuditAgentProfile records an operator's verdict on a pending subject. The
// source status is re-checked under the row lock so two reviewers cannot both
// decide the same submission.
func AuditAgentProfile(id int, adminId int, approve bool, reason string) error {
	reason = strings.TrimSpace(reason)
	if !approve && reason == "" {
		return ErrAgentReasonRequired
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		var profile AgentProfile
		if err := lockForUpdate(tx).Where("id = ?", id).First(&profile).Error; err != nil {
			return ErrAgentProfileNotFound
		}
		if profile.Status != AgentStatusPending {
			return ErrAgentStatusInvalid
		}

		status := AgentStatusRejected
		if approve {
			status = AgentStatusActive
			reason = ""
		}
		return tx.Model(&AgentProfile{}).Where("id = ?", profile.Id).
			Updates(map[string]interface{}{
				"status":        status,
				"reject_reason": reason,
				"audit_by":      adminId,
				"audit_time":    common.GetTimestamp(),
			}).Error
	})
}

// SetAgentCommissionRate overrides one agent's rate. A nil rate clears the
// override so the profile follows the global default again, which is why the
// column is nullable rather than zero-defaulted: an explicit zero means "this
// agent earns nothing" and must survive.
func SetAgentCommissionRate(userId int, rate *float64) error {
	if rate != nil && !setting.IsCommissionRateValid(*rate) {
		return ErrAgentRateInvalid
	}

	profile, err := GetAgentProfileByUserId(userId)
	if err != nil {
		return err
	}
	return DB.Model(&AgentProfile{}).Where("id = ?", profile.Id).
		Update("commission_rate", rate).Error
}

// SetAgentStatus suspends or reactivates an agent. Suspension only stops new
// commission from being earned; commission already in the ledger stays
// withdrawable, so this is not a way to withhold money already owed.
func SetAgentStatus(userId int, status string) error {
	if status != AgentStatusActive && status != AgentStatusSuspended {
		return ErrAgentStatusInvalid
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		var profile AgentProfile
		if err := lockForUpdate(tx).Where("user_id = ?", userId).First(&profile).Error; err != nil {
			return ErrAgentProfileNotFound
		}
		// Only the active <-> suspended pair is an operator toggle. Reaching active
		// from any other state is an audit decision and belongs to
		// AuditAgentProfile, which records who approved it.
		if profile.Status != AgentStatusActive && profile.Status != AgentStatusSuspended {
			return ErrAgentStatusInvalid
		}
		if profile.Status == status {
			return nil
		}
		return tx.Model(&AgentProfile{}).Where("id = ?", profile.Id).
			Update("status", status).Error
	})
}

// AgentProfileWithUser is one row of the admin agent list: the profile plus the
// account it belongs to and the denormalized commission summaries, so the list
// renders without a per-row user lookup.
//
// The summary columns are display and sort material only. Every funds decision
// re-aggregates the ledger under a row lock (see ClaimCommissionForWithdrawal).
type AgentProfileWithUser struct {
	*AgentProfile
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`

	CustomerCount int `json:"customer_count" gorm:"-"`

	CommissionTotal     float64 `json:"commission_total"`
	CommissionAvailable float64 `json:"commission_available"`
	WithdrawnTotal      float64 `json:"withdrawn_total"`
}

func GetAgentProfiles(status string, keyword string, pageInfo *common.PageInfo) ([]*AgentProfileWithUser, int64, error) {
	// The soft-delete predicate lives in the JOIN so a deleted account drops its
	// user columns instead of dropping the profile row: an orphaned profile must
	// still be visible to whoever has to clean it up.
	query := DB.Model(&AgentProfile{}).
		Select("agent_profiles.*, " +
			"COALESCE(users.username, '') AS username, " +
			"COALESCE(users.display_name, '') AS display_name, " +
			"COALESCE(users.agent_commission_total, 0) AS commission_total, " +
			"COALESCE(users.agent_commission_available, 0) AS commission_available, " +
			"COALESCE(users.agent_withdrawn_total, 0) AS withdrawn_total").
		Joins("LEFT JOIN users ON users.id = agent_profiles.user_id AND users.deleted_at IS NULL")

	if status != "" {
		query = query.Where("agent_profiles.status = ?", status)
	}
	if keyword != "" {
		pattern, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		query = query.Where("(users.username LIKE ? ESCAPE '!' OR users.display_name LIKE ? ESCAPE '!'"+
			" OR agent_profiles.subject_name LIKE ? ESCAPE '!' OR agent_profiles.company_name LIKE ? ESCAPE '!'"+
			" OR agent_profiles.contact_name LIKE ? ESCAPE '!')",
			pattern, pattern, pattern, pattern, pattern)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []*AgentProfileWithUser
	err := query.Order("agent_profiles.id desc").
		Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	if len(rows) == 0 {
		return rows, total, nil
	}

	// Customer counts are fetched for the page in one grouped query rather than a
	// correlated subquery per row: users is large, and the page is the only bound
	// that keeps this off a full scan.
	userIds := make([]int, 0, len(rows))
	for _, row := range rows {
		userIds = append(userIds, row.UserId)
	}
	var counts []struct {
		InviterId int
		Total     int
	}
	if err := DB.Model(&User{}).
		Select("inviter_id, COUNT(*) AS total").
		Where("inviter_id IN ?", userIds).
		Group("inviter_id").
		Find(&counts).Error; err != nil {
		return nil, 0, err
	}
	countByInviter := make(map[int]int, len(counts))
	for _, c := range counts {
		countByInviter[c.InviterId] = c.Total
	}
	for _, row := range rows {
		row.CustomerCount = countByInviter[row.UserId]
	}

	return rows, total, nil
}

