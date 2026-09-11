package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// RecordTopUpCommissionHook is filled in by service.InitAgentCommissionHook at
// startup. The indirection exists because the commission engine lives in
// service, which already imports model: a direct call from here would be an
// import cycle. Nil means the engine was never wired (e.g. a test binary that
// only links model), in which case every settlement path stays unchanged.
var RecordTopUpCommissionHook func(tx *gorm.DB, topUpId int, payerUserId int, money float64) error

// recordTopUpCommission records the distributor commission for a settled
// top-up inside the top-up's own transaction, and never lets that recording
// fail the top-up (design doc 5.3). The customer paid: the money must land.
// Commission is an add-on that can be reconciled later.
//
// The insert is wrapped in a nested transaction so GORM brackets it with a
// SAVEPOINT. Without it, swallowing an error would be unsafe on PostgreSQL,
// where a single failed statement aborts the whole transaction and turns the
// later COMMIT into a silent ROLLBACK - the customer's quota would vanish
// because of a commission bookkeeping problem.
//
// The base is topUp.Money, the real money paid, never the credited quota: a
// configured top-up bonus ratio would otherwise be shared out as commission.
func recordTopUpCommission(tx *gorm.DB, topUp *TopUp) {
	if RecordTopUpCommissionHook == nil || topUp == nil {
		return
	}
	err := tx.Transaction(func(commissionTx *gorm.DB) error {
		return RecordTopUpCommissionHook(commissionTx, topUp.Id, topUp.UserId, topUp.Money)
	})
	if err == nil || errors.Is(err, ErrCommissionDuplicate) {
		// A duplicate is a replayed payment callback, which is routine. Stay silent.
		return
	}
	common.SysError("agent commission record failed: trade_no=" + topUp.TradeNo + " err=" + err.Error())
}
