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

// ErrWithdrawalMethodInvalid rejects an unrecognized payout route. The method
// decides whether money leaves the platform, so an unknown value is refused
// rather than defaulted into either branch.
var ErrWithdrawalMethodInvalid = errors.New("withdrawal method invalid")

// CreateWithdrawalParams is the validated input for one payout request.
type CreateWithdrawalParams struct {
	UserId int
	Amount float64
	Method string
	Remark string
}

// CreateWithdrawal records one payout request and reserves the commission behind
// it. Every gate runs inside one transaction, in the order the design fixes
// (6.1), because the last of them — the balance check — is only sound while the
// claim it authorizes happens under the same lock.
//
// A balance payout with auditing disabled completes here: the money never leaves
// the platform, so it is credited, marked paid, and closed in the same
// transaction. A bank payout stops at pending for a human to approve.
func CreateWithdrawal(params CreateWithdrawalParams) (*AgentWithdrawal, error) {
	// decimal.NewFromFloat panics on NaN and infinity, so the amount is screened
	// before any money math starts.
	if math.IsNaN(params.Amount) || math.IsInf(params.Amount, 0) || params.Amount <= 0 {
		return nil, ErrWithdrawalAmountInvalid
	}
	if params.Method != WithdrawalMethodBalance && params.Method != WithdrawalMethodBank {
		return nil, ErrWithdrawalMethodInvalid
	}

	amount := decimal.NewFromFloat(params.Amount).Round(2)
	if !amount.IsPositive() {
		return nil, ErrWithdrawalAmountInvalid
	}

	feeRate := setting.AgentWithdrawalFeeRate
	if math.IsNaN(feeRate) || math.IsInf(feeRate, 0) || feeRate < 0 || feeRate >= 1 {
		// A misconfigured rate would either credit the agent extra or consume the
		// whole payout. Failing loudly beats paying out on a guess.
		return nil, ErrWithdrawalAmountInvalid
	}
	// The fee rounds up so a fractional cent is never absorbed by the platform;
	// the agent receives what is left.
	fee := amount.Mul(decimal.NewFromFloat(feeRate)).RoundUp(2)
	actual := amount.Sub(fee)
	if !actual.IsPositive() {
		return nil, ErrWithdrawalAmountInvalid
	}

	minWithdrawal := setting.AgentMinWithdrawal
	if math.IsNaN(minWithdrawal) || math.IsInf(minWithdrawal, 0) || minWithdrawal < 0 {
		minWithdrawal = 0
	}

	withdrawal := &AgentWithdrawal{
		AgentUserId:  params.UserId,
		Amount:       amount.InexactFloat64(),
		Fee:          fee.InexactFloat64(),
		ActualAmount: actual.InexactFloat64(),
		Method:       params.Method,
		Status:       WithdrawalStatusPending,
		Remark:       truncateAgentRemark(strings.TrimSpace(params.Remark)),
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var profile AgentProfile
		if err := lockForUpdate(tx).Where("user_id = ?", params.UserId).First(&profile).Error; err != nil {
			return ErrAgentProfileNotFound
		}
		if profile.Status != AgentStatusActive {
			return ErrAgentProfileNotActive
		}

		if params.Method == WithdrawalMethodBank {
			// A company subject is named by its company name, a personal one by the
			// subject name; either way finance needs a payee to put on the transfer.
			payee := profile.SubjectName
			if profile.AgentType == AgentTypeCompany {
				payee = profile.CompanyName
			}
			if profile.BankName == "" || profile.BankAccount == "" || payee == "" {
				return ErrWithdrawalBankIncomplete
			}
		}

		if amount.LessThan(decimal.NewFromFloat(minWithdrawal)) {
			return ErrWithdrawalBelowMinimum
		}

		// One in-flight request at a time. Concurrent requests would each claim a
		// slice of the same pool and, between them, drain more than the agent can
		// account for in a single review.
		var inFlight int64
		if err := tx.Model(&AgentWithdrawal{}).
			Where("agent_user_id = ? AND status IN ?", params.UserId,
				[]string{WithdrawalStatusPending, WithdrawalStatusApproved}).
			Count(&inFlight).Error; err != nil {
			return err
		}
		if inFlight > 0 {
			return ErrWithdrawalInFlight
		}

		// The payee details are frozen at submission: an agent who edits their bank
		// account afterwards must not be able to retarget a transfer finance has
		// already been asked to send.
		snapshot, err := common.Marshal(&profile)
		if err != nil {
			return err
		}
		withdrawal.ProfileSnapshot = string(snapshot)

		if err := tx.Create(withdrawal).Error; err != nil {
			return err
		}
		// The claim needs the withdrawal id, so it necessarily follows the insert.
		// Both are in this transaction: a claim that fails takes the request with it.
		if err := ClaimCommissionForWithdrawal(tx, params.UserId, withdrawal.Amount, withdrawal.Id); err != nil {
			return err
		}

		if params.Method != WithdrawalMethodBalance || setting.AgentBalanceNeedAudit {
			return nil
		}

		if err := creditWithdrawalToBalance(tx, withdrawal); err != nil {
			return err
		}
		if err := MarkCommissionPaid(tx, withdrawal.Id); err != nil {
			return err
		}
		withdrawal.Status = WithdrawalStatusPaid
		withdrawal.PayTime = common.GetTimestamp()
		return tx.Model(&AgentWithdrawal{}).Where("id = ?", withdrawal.Id).
			Updates(map[string]interface{}{
				"status":   withdrawal.Status,
				"pay_time": withdrawal.PayTime,
			}).Error
	})
	if err != nil {
		return nil, err
	}

	refreshAgentSummaryBestEffort(params.UserId)
	return withdrawal, nil
}

// creditWithdrawalToBalance moves a balance payout into the agent's wallet. Both
// balance routes go through here — the immediate one and the audited one — so the
// conversion and its ceiling check cannot drift apart.
//
// The wallet is a 32-bit quota column, so the conversion is the checked one: a
// saturated value would silently pay out less than the ledger says was claimed,
// and failing the transaction leaves the commission claimable instead.
func creditWithdrawalToBalance(tx *gorm.DB, withdrawal *AgentWithdrawal) error {
	if math.IsNaN(withdrawal.ActualAmount) || math.IsInf(withdrawal.ActualAmount, 0) || withdrawal.ActualAmount <= 0 {
		return ErrWithdrawalAmountInvalid
	}

	quota, clamp := common.QuotaFromDecimalChecked(
		decimal.NewFromFloat(withdrawal.ActualAmount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
	)
	if clamp != nil {
		common.SysError(fmt.Sprintf("agent withdrawal %d for user %d: %s",
			withdrawal.Id, withdrawal.AgentUserId, clamp.Error()))
		return clamp
	}
	return creditTopUpQuota(tx, withdrawal.AgentUserId, quota, nil)
}

// lockWithdrawalForTransition reads one request under a row lock and verifies it
// is in a state the caller may leave. Every status change goes through this so two
// operators cannot both approve, or approve and reject, the same payout.
//
// A positive agentUserId additionally scopes the row to its owner, which is what
// keeps an agent's cancel from reaching somebody else's request.
func lockWithdrawalForTransition(tx *gorm.DB, id int, agentUserId int, allowed ...string) (*AgentWithdrawal, error) {
	query := lockForUpdate(tx).Where("id = ?", id)
	if agentUserId > 0 {
		query = query.Where("agent_user_id = ?", agentUserId)
	}
	var withdrawal AgentWithdrawal
	if err := query.First(&withdrawal).Error; err != nil {
		return nil, ErrWithdrawalNotFound
	}
	for _, status := range allowed {
		if withdrawal.Status == status {
			return &withdrawal, nil
		}
	}
	return nil, ErrWithdrawalStatusInvalid
}

// CancelWithdrawal withdraws an agent's own pending request and releases the
// commission it held. There is no cancelled status in the state machine, so the
// request lands on rejected with the cancellation recorded as its reason.
func CancelWithdrawal(id int, userId int) error {
	if userId <= 0 {
		return ErrWithdrawalNotFound
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		withdrawal, err := lockWithdrawalForTransition(tx, id, userId, WithdrawalStatusPending)
		if err != nil {
			return err
		}
		if err := tx.Model(&AgentWithdrawal{}).Where("id = ?", withdrawal.Id).
			Updates(map[string]interface{}{
				"status":        WithdrawalStatusRejected,
				"reject_reason": "cancelled by agent",
			}).Error; err != nil {
			return err
		}
		return ReleaseCommissionForWithdrawal(tx, withdrawal.Id)
	})
	if err != nil {
		return err
	}

	refreshAgentSummaryBestEffort(userId)
	return nil
}

// AuditWithdrawal records the review verdict. Approval only clears the request for
// payment; the commission stays frozen until the money actually moves. Rejection
// releases it immediately so the agent is not left waiting on a dead request.
func AuditWithdrawal(id int, adminId int, approve bool, reason string) error {
	reason = strings.TrimSpace(reason)
	if !approve && reason == "" {
		return ErrAgentReasonRequired
	}

	var agentUserId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		withdrawal, err := lockWithdrawalForTransition(tx, id, 0, WithdrawalStatusPending)
		if err != nil {
			return err
		}
		agentUserId = withdrawal.AgentUserId

		status := WithdrawalStatusApproved
		if !approve {
			status = WithdrawalStatusRejected
		} else {
			reason = ""
		}
		if err := tx.Model(&AgentWithdrawal{}).Where("id = ?", withdrawal.Id).
			Updates(map[string]interface{}{
				"status":        status,
				"reject_reason": reason,
				"audit_by":      adminId,
				"audit_time":    common.GetTimestamp(),
			}).Error; err != nil {
			return err
		}
		if approve {
			return nil
		}
		return ReleaseCommissionForWithdrawal(tx, withdrawal.Id)
	})
	if err != nil {
		return err
	}

	refreshAgentSummaryBestEffort(agentUserId)
	return nil
}

// CompleteWithdrawal closes an approved payout. A bank transfer is an offline act
// that the system only records, but an approved balance payout still has to be
// credited here — otherwise enabling AgentBalanceNeedAudit would leave the
// commission consumed and the wallet never funded.
//
// audit_by is left as the approver's id: who paid is recorded by pay_voucher and
// the audit log, and overwriting it would erase who authorized the payment.
func CompleteWithdrawal(id int, adminId int, voucher string) error {
	var agentUserId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		withdrawal, err := lockWithdrawalForTransition(tx, id, 0, WithdrawalStatusApproved)
		if err != nil {
			return err
		}
		agentUserId = withdrawal.AgentUserId

		if withdrawal.Method == WithdrawalMethodBalance {
			if err := creditWithdrawalToBalance(tx, withdrawal); err != nil {
				return err
			}
		}
		if err := MarkCommissionPaid(tx, withdrawal.Id); err != nil {
			return err
		}
		return tx.Model(&AgentWithdrawal{}).Where("id = ?", withdrawal.Id).
			Updates(map[string]interface{}{
				"status":      WithdrawalStatusPaid,
				"pay_time":    common.GetTimestamp(),
				"pay_voucher": strings.TrimSpace(voucher),
			}).Error
	})
	if err != nil {
		return err
	}

	refreshAgentSummaryBestEffort(agentUserId)
	return nil
}

// FailWithdrawal records a payout that finance could not complete, for example a
// rejected transfer. The commission returns to the withdrawable pool: the money
// never left, so the agent is still owed it.
func FailWithdrawal(id int, adminId int, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return ErrAgentReasonRequired
	}

	var agentUserId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		withdrawal, err := lockWithdrawalForTransition(tx, id, 0, WithdrawalStatusApproved)
		if err != nil {
			return err
		}
		agentUserId = withdrawal.AgentUserId

		if err := tx.Model(&AgentWithdrawal{}).Where("id = ?", withdrawal.Id).
			Updates(map[string]interface{}{
				"status":        WithdrawalStatusRejected,
				"reject_reason": reason,
				"audit_by":      adminId,
				"audit_time":    common.GetTimestamp(),
			}).Error; err != nil {
			return err
		}
		return ReleaseCommissionForWithdrawal(tx, withdrawal.Id)
	})
	if err != nil {
		return err
	}

	refreshAgentSummaryBestEffort(agentUserId)
	return nil
}

// AgentWithdrawalWithUser is one row of the payout queue with the agent named.
type AgentWithdrawalWithUser struct {
	*AgentWithdrawal
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

// GetWithdrawals lists payout requests. An agentUserId of 0 means the admin
// queue; any positive value scopes the query to that agent.
//
// Ordered oldest first: this is a work queue, and finance handles it first come,
// first served (design 10.2).
func GetWithdrawals(agentUserId int, status string, method string, pageInfo *common.PageInfo) ([]*AgentWithdrawalWithUser, int64, error) {
	query := DB.Model(&AgentWithdrawal{}).
		Select("agent_withdrawals.*, " +
			"COALESCE(users.username, '') AS username, " +
			"COALESCE(users.display_name, '') AS display_name").
		Joins("LEFT JOIN users ON users.id = agent_withdrawals.agent_user_id AND users.deleted_at IS NULL")

	if agentUserId > 0 {
		query = query.Where("agent_withdrawals.agent_user_id = ?", agentUserId)
	}
	if status != "" {
		query = query.Where("agent_withdrawals.status = ?", status)
	}
	if method != "" {
		query = query.Where("agent_withdrawals.method = ?", method)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []*AgentWithdrawalWithUser
	err := query.Order("agent_withdrawals.create_time asc, agent_withdrawals.id asc").
		Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func GetWithdrawalById(id int) (*AgentWithdrawal, error) {
	var withdrawal AgentWithdrawal
	if err := DB.Where("id = ?", id).First(&withdrawal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWithdrawalNotFound
		}
		return nil, err
	}
	return &withdrawal, nil
}

// GetWithdrawalCommissions returns the ledger rows this payout claimed, which is
// what finance checks before transferring: the audit requires the money's source
// to be traceable to specific customers' orders (design 10.2).
//
// Released rows do not appear — the release clears withdrawal_id — so this reads
// as the claim of a live request rather than of every request that ever touched
// these rows.
func GetWithdrawalCommissions(withdrawalId int) ([]*AgentCommission, error) {
	var commissions []*AgentCommission
	err := DB.Where("withdrawal_id = ?", withdrawalId).
		Order("create_time asc, id asc").
		Find(&commissions).Error
	return commissions, err
}
