package model

import (
	"errors"
)

// Agent profile lifecycle. A profile starts incomplete so a user can promote
// and earn before submitting identity documents; only an active profile may
// withdraw.
const (
	AgentStatusIncomplete = "incomplete"
	AgentStatusPending    = "pending"
	AgentStatusActive     = "active"
	AgentStatusRejected   = "rejected"
	AgentStatusSuspended  = "suspended"
)

// Agent subject kind. A company subject additionally carries a tax number.
const (
	AgentTypePersonal = "personal"
	AgentTypeCompany  = "company"
)

// Commission lifecycle. Rows are append-only: a correction is a new row, never
// an update of history.
const (
	CommissionStatusPending  = "pending"  // within the freeze window
	CommissionStatusSettled  = "settled"  // withdrawable
	CommissionStatusFrozen   = "frozen"   // claimed by a withdrawal under review
	CommissionStatusPaid     = "paid"     // paid out
	CommissionStatusReversed = "reversed" // negative row offsetting a refund
)

// Commission source kinds.
const (
	CommissionSourceTopUp        = "topup"
	CommissionSourceSubscription = "subscription"
	CommissionSourceAdjust       = "adjust" // manual correction by an admin
)

// Withdrawal lifecycle. A balance withdrawal settles immediately and therefore
// skips straight to paid; a bank withdrawal walks the review queue.
const (
	WithdrawalStatusPending  = "pending"
	WithdrawalStatusApproved = "approved"
	WithdrawalStatusPaid     = "paid"
	WithdrawalStatusRejected = "rejected"
)

// Withdrawal payout route.
const (
	WithdrawalMethodBalance = "balance"
	WithdrawalMethodBank    = "bank"
)

var (
	ErrAgentProfileNotFound     = errors.New("agent profile not found")
	ErrAgentProfileNotActive    = errors.New("agent profile is not active")
	ErrAgentStatusInvalid       = errors.New("agent profile status invalid")
	ErrAgentRateInvalid         = errors.New("commission rate invalid")
	ErrCommissionDuplicate      = errors.New("commission already recorded")
	ErrCommissionInsufficient   = errors.New("insufficient withdrawable commission")
	ErrWithdrawalNotFound       = errors.New("withdrawal not found")
	ErrWithdrawalStatusInvalid  = errors.New("withdrawal status invalid")
	ErrWithdrawalInFlight       = errors.New("a withdrawal is already under review")
	ErrWithdrawalBelowMinimum   = errors.New("withdrawal amount below minimum")
	ErrWithdrawalBankIncomplete = errors.New("bank payout requires complete payee details")
	ErrWithdrawalAmountInvalid  = errors.New("withdrawal amount invalid")
	ErrAgentSelfReferral        = errors.New("self referral is not allowed")
)

// AgentProfile is one user's distributor identity. The subject and payee fields
// are what an administrator reviews before withdrawals are unlocked.
type AgentProfile struct {
	Id     int `json:"id"`
	UserId int `json:"user_id" gorm:"uniqueIndex"`

	AgentType string `json:"agent_type" gorm:"type:varchar(16);not null;default:'personal'"`
	Status    string `json:"status" gorm:"type:varchar(16);not null;default:'incomplete';index"`
	Level     string `json:"level" gorm:"type:varchar(32);default:''"`

	// CommissionRate is a pointer so "never configured, follow the global
	// default" stays distinguishable from "explicitly set to zero".
	CommissionRate *float64 `json:"commission_rate" gorm:""`

	SubjectName string `json:"subject_name" gorm:"type:varchar(64);default:''"`
	IdNo        string `json:"id_no" gorm:"type:varchar(64);default:''"`
	CompanyName string `json:"company_name" gorm:"type:varchar(255);default:''"`
	TaxNo       string `json:"tax_no" gorm:"type:varchar(64);default:''"`

	BankName    string `json:"bank_name" gorm:"type:varchar(255);default:''"`
	BankAccount string `json:"bank_account" gorm:"type:varchar(64);default:''"`
	BankBranch  string `json:"bank_branch" gorm:"type:varchar(255);default:''"`

	ContactName  string `json:"contact_name" gorm:"type:varchar(64);default:''"`
	ContactPhone string `json:"contact_phone" gorm:"type:varchar(32);default:''"`
	ContactEmail string `json:"contact_email" gorm:"type:varchar(128);default:''"`

	AuditBy      int    `json:"audit_by" gorm:"default:0"`
	AuditTime    int64  `json:"audit_time" gorm:"default:0"`
	RejectReason string `json:"reject_reason" gorm:"type:varchar(255);default:''"`
	Remark       string `json:"remark" gorm:"type:varchar(255);default:''"`

	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime"`
}

// AgentCommission is one ledger entry. The (agent_user_id, source_type,
// source_id) unique index is the sole authority on idempotency: payment
// callbacks replay routinely, and a read-then-insert check would race.
type AgentCommission struct {
	Id          int `json:"id"`
	AgentUserId int `json:"agent_user_id" gorm:"index;index:idx_agent_comm_status,priority:1;uniqueIndex:idx_agent_comm_source,priority:1"`
	FromUserId  int `json:"from_user_id" gorm:"index"`

	SourceType string `json:"source_type" gorm:"type:varchar(32);not null;uniqueIndex:idx_agent_comm_source,priority:2"`
	SourceId   int    `json:"source_id" gorm:"not null;uniqueIndex:idx_agent_comm_source,priority:3"`

	BaseAmount float64 `json:"base_amount" gorm:"not null"`
	Rate       float64 `json:"rate" gorm:"not null"`
	Amount     float64 `json:"amount" gorm:"not null"`

	Status        string `json:"status" gorm:"type:varchar(16);not null;index:idx_agent_comm_status,priority:2"`
	AvailableTime int64  `json:"available_time" gorm:"default:0;index"`
	WithdrawalId  int    `json:"withdrawal_id" gorm:"default:0;index"`

	Remark     string `json:"remark" gorm:"type:varchar(255);default:''"`
	CreateTime int64  `json:"create_time" gorm:"autoCreateTime;index"`
}

// AgentWithdrawal is one payout request. ProfileSnapshot freezes the payee
// details at submission so later profile edits cannot retarget money that
// finance has already been asked to send.
type AgentWithdrawal struct {
	Id          int `json:"id"`
	AgentUserId int `json:"agent_user_id" gorm:"index;index:idx_agent_wd_status,priority:1"`

	Amount       float64 `json:"amount" gorm:"not null"`
	Fee          float64 `json:"fee" gorm:"default:0"`
	ActualAmount float64 `json:"actual_amount" gorm:"not null"`

	Method string `json:"method" gorm:"type:varchar(16);not null"`
	Status string `json:"status" gorm:"type:varchar(16);not null;index:idx_agent_wd_status,priority:2"`

	ProfileSnapshot string `json:"profile_snapshot" gorm:"type:text"`

	AuditBy      int    `json:"audit_by" gorm:"default:0"`
	AuditTime    int64  `json:"audit_time" gorm:"default:0"`
	PayTime      int64  `json:"pay_time" gorm:"default:0"`
	PayVoucher   string `json:"pay_voucher" gorm:"type:varchar(255);default:''"`
	RejectReason string `json:"reject_reason" gorm:"type:varchar(255);default:''"`
	Remark       string `json:"remark" gorm:"type:varchar(255);default:''"`

	CreateTime int64 `json:"create_time" gorm:"autoCreateTime;index"`
}
