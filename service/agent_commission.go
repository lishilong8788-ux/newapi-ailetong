package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

var (
	ErrCommissionBaseInvalid = errors.New("commission base amount invalid")
	ErrCommissionRateInvalid = errors.New("commission rate out of range")
)

// commissionScale is the currency precision of a commission row: money is
// settled in cents, so anything finer than 2 decimal places is not payable.
const commissionScale int32 = 2

// CalculateCommission returns baseAmount * rate rounded DOWN to 2 decimal
// places. Rounding down is deliberate: a fraction of a cent given away on every
// order accumulates into an unrecoverable platform loss, while a fraction of a
// cent withheld is invisible to the agent. The multiplication runs through
// decimal because float64 cannot represent most money values exactly - e.g.
// 1.40 * 0.05 is 0.06999999... in float64, which truncates to 0.06 instead of
// the correct 0.07.
func CalculateCommission(baseAmount float64, rate float64) (float64, error) {
	// decimal.NewFromFloat panics on NaN/Inf, so both operands are screened
	// before they reach it.
	if math.IsNaN(baseAmount) || math.IsInf(baseAmount, 0) || baseAmount < 0 {
		return 0, ErrCommissionBaseInvalid
	}
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 || rate > 1 {
		return 0, ErrCommissionRateInvalid
	}

	amount := decimal.NewFromFloat(baseAmount).Mul(decimal.NewFromFloat(rate)).RoundDown(commissionScale)
	return amount.InexactFloat64(), nil
}

// RecordTopUpCommissionTx inserts the commission owed to the payer's inviter for
// one successful top-up. It runs inside the caller's top-up transaction (see
// design doc 5.3): a single INSERT with no row locks, so concurrent top-ups by
// customers of the same agent never block each other, and the (agent_user_id,
// source_type, source_id) unique index - not any read-then-write check here - is
// what makes a replayed payment callback a no-op.
//
// money MUST be topUp.Money, the amount the customer actually paid. The credited
// quota is the wrong base: top-up bonus ratios (common/topup-ratio.go) inflate
// it, and paying commission on a platform-funded bonus makes the platform buy
// the same commission twice.
func RecordTopUpCommissionTx(tx *gorm.DB, topUpId int, payerUserId int, money float64) error {
	if !setting.AgentEnabled {
		return nil
	}
	if topUpId <= 0 || payerUserId <= 0 {
		return nil
	}

	// The inviter is read off the caller's tx so attribution matches the state
	// the top-up itself committed against.
	var payer model.User
	if err := tx.Model(&model.User{}).Select("id", "inviter_id").Where("id = ?", payerUserId).First(&payer).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if payer.InviterId <= 0 {
		return nil
	}
	// Self-referral guard (design doc 7.2): a user who managed to point their own
	// invite code at themselves would otherwise get a discount on every top-up.
	if payer.InviterId == payerUserId {
		return nil
	}

	profile, err := model.GetAgentProfileByUserId(payer.InviterId)
	if err != nil {
		// An inviter without a distributor profile is the normal case for the
		// pre-existing affiliate programme, not an error.
		if errors.Is(err, model.ErrAgentProfileNotFound) || errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	// Two independent gates (design doc 4.2):
	//
	// approved_at == 0 means this profile has never passed review - incomplete,
	// pending and rejected all land here - and an unapproved applicant earns
	// nothing. Once approved, the stamp is permanent, so an agent who edits their
	// bank details and goes back to pending for re-review keeps earning: the
	// programme admitted them already, and a paused ledger during a clerical
	// re-check would be indistinguishable from a bug.
	//
	// suspended stops NEW commission only; commission already in the ledger stays
	// withdrawable, so nothing else is touched here.
	if profile.ApprovedAt == 0 || profile.Status == model.AgentStatusSuspended {
		return nil
	}

	rate := setting.EffectiveCommissionRate(profile.CommissionRate)
	if rate <= 0 {
		return nil
	}
	amount, err := CalculateCommission(money, rate)
	if err != nil {
		return err
	}
	if amount <= 0 {
		return nil
	}

	freezeDays := setting.AgentFreezeDays
	if freezeDays < 0 {
		freezeDays = 0
	}
	commission := &model.AgentCommission{
		AgentUserId:   profile.UserId,
		FromUserId:    payerUserId,
		SourceType:    model.CommissionSourceTopUp,
		SourceId:      topUpId,
		BaseAmount:    money,
		Rate:          rate,
		Amount:        amount,
		Status:        model.CommissionStatusPending,
		AvailableTime: common.GetTimestamp() + int64(freezeDays)*86400,
	}
	return model.RecordCommissionTx(tx, commission)
}

// InitAgentCommissionHook wires the commission engine into the top-up
// settlement paths. model cannot import service (service already imports
// model), so model exposes a function variable that this assignment fills in.
func InitAgentCommissionHook() {
	model.RecordTopUpCommissionHook = RecordTopUpCommissionTx
}

const agentCommissionSettleInterval = 1 * time.Hour

var agentCommissionSettleOnce sync.Once

// StartAgentCommissionSettleTask runs the freeze-window worker hourly on the
// master node. Hourly is enough precision: the window is measured in days.
func StartAgentCommissionSettleTask() {
	agentCommissionSettleOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("agent commission settle task started: tick=%s", agentCommissionSettleInterval))
			ticker := time.NewTicker(agentCommissionSettleInterval)
			defer ticker.Stop()

			SettleMaturedCommissionsJob()
			for range ticker.C {
				SettleMaturedCommissionsJob()
			}
		})
	})
}

// SettleMaturedCommissionsJob promotes pending commission whose freeze window
// has elapsed to settled. It recovers from panics so a bad row can never take
// the worker goroutine (and with it every later settlement) down.
func SettleMaturedCommissionsJob() {
	defer func() {
		if r := recover(); r != nil {
			common.SysError(fmt.Sprintf("agent commission settle task panic: %v", r))
		}
	}()

	if !setting.AgentEnabled {
		return
	}
	settled, err := model.SettleMaturedCommissions()
	if err != nil {
		common.SysError("agent commission settle failed: " + err.Error())
		return
	}
	if settled > 0 {
		common.SysLog(fmt.Sprintf("agent commission settled: count=%d", settled))
	}
}
