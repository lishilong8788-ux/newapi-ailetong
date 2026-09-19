package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupCommissionGateFixture gives each case its own in-memory database with the
// programme switched on, one inviter and one paying customer pointed at them.
func setupCommissionGateFixture(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := model.DB
	previousEnabled := setting.AgentEnabled
	previousRate := setting.AgentDefaultRate

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.AgentProfile{}, &model.AgentCommission{}, &model.AgentWithdrawal{}))
	model.DB = db
	setting.AgentEnabled = true
	setting.AgentDefaultRate = 0.05
	t.Cleanup(func() {
		model.DB = previousDB
		setting.AgentEnabled = previousEnabled
		setting.AgentDefaultRate = previousRate
	})

	for _, user := range []*model.User{
		{Id: 1, Username: "inviter", Password: "unused", AffCode: "inv1", Status: common.UserStatusEnabled, Group: "default"},
		{Id: 2, Username: "payer", Password: "unused", AffCode: "pay1", InviterId: 1, Status: common.UserStatusEnabled, Group: "default"},
	} {
		require.NoError(t, db.Create(user).Error)
	}
	return db
}

func countCommissionRows(t *testing.T, db *gorm.DB, agentUserId int) int64 {
	t.Helper()
	var total int64
	require.NoError(t, db.Model(&model.AgentCommission{}).Where("agent_user_id = ?", agentUserId).Count(&total).Error)
	return total
}

// The approval gate is the whole point of the programme's money rules: only an
// inviter the operator has approved at least once may earn. The states are close
// enough to each other that only an explicit table keeps them apart - "pending"
// means opposite things depending on whether approved_at is set.
func TestRecordTopUpCommissionTx_RequiresEverApproved(t *testing.T) {
	cases := []struct {
		name       string
		hasProfile bool
		status     string
		approvedAt int64
		earns      bool
	}{
		{name: "no profile at all", hasProfile: false},
		{name: "incomplete and never approved", hasProfile: true, status: model.AgentStatusIncomplete},
		{name: "pending first review", hasProfile: true, status: model.AgentStatusPending},
		{name: "rejected", hasProfile: true, status: model.AgentStatusRejected},
		// An approved agent who edited their bank details is back in the queue but
		// keeps earning: the programme admitted them already, and pausing the ledger
		// for a clerical re-check is indistinguishable from a bug.
		{name: "approved then edited, now re-reviewing", hasProfile: true, status: model.AgentStatusPending, approvedAt: 1700000000, earns: true},
		{name: "approved and active", hasProfile: true, status: model.AgentStatusActive, approvedAt: 1700000000, earns: true},
		// Suspension stops NEW commission; the existing ledger is untouched.
		{name: "approved then suspended", hasProfile: true, status: model.AgentStatusSuspended, approvedAt: 1700000000},
		// Defensive: a rejection must not be able to ride an old approval stamp into
		// the ledger. Nothing writes this combination today.
		{name: "rejected despite an old approval", hasProfile: true, status: model.AgentStatusRejected, approvedAt: 1700000000, earns: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := setupCommissionGateFixture(t)
			if tc.hasProfile {
				require.NoError(t, db.Create(&model.AgentProfile{
					UserId: 1, AgentType: model.AgentTypePersonal, Status: tc.status, ApprovedAt: tc.approvedAt,
				}).Error)
			}

			require.NoError(t, RecordTopUpCommissionTx(db, 1001, 2, 200))

			if !tc.earns {
				assert.Zero(t, countCommissionRows(t, db, 1))
				return
			}
			var commission model.AgentCommission
			require.NoError(t, db.Where("agent_user_id = ?", 1).First(&commission).Error)
			assert.Equal(t, 2, commission.FromUserId)
			assert.Equal(t, 200.0, commission.BaseAmount)
			assert.Equal(t, 0.05, commission.Rate)
			assert.Equal(t, 10.0, commission.Amount)
			assert.Equal(t, model.CommissionStatusPending, commission.Status)
		})
	}
}

// A profile that only becomes payable after approval must start paying from the
// approval onward, and the top-ups that happened while it was pending stay
// unpaid - approval is not retroactive.
func TestRecordTopUpCommissionTx_EarnsOnlyAfterApproval(t *testing.T) {
	db := setupCommissionGateFixture(t)
	require.NoError(t, db.Create(&model.AgentProfile{
		UserId: 1, AgentType: model.AgentTypePersonal, Status: model.AgentStatusPending,
		SubjectName: "Agent One", IdNo: "110101199001010011",
	}).Error)

	require.NoError(t, RecordTopUpCommissionTx(db, 2001, 2, 200))
	require.Zero(t, countCommissionRows(t, db, 1), "a top-up during review earns nothing")

	var profile model.AgentProfile
	require.NoError(t, db.Where("user_id = ?", 1).First(&profile).Error)
	require.NoError(t, model.AuditAgentProfile(profile.Id, 9, true, ""))

	require.NoError(t, RecordTopUpCommissionTx(db, 2002, 2, 200))
	assert.Equal(t, int64(1), countCommissionRows(t, db, 1))

	// The earlier top-up is not back-paid by the approval.
	var earlier int64
	require.NoError(t, db.Model(&model.AgentCommission{}).Where("source_id = ?", 2001).Count(&earlier).Error)
	assert.Zero(t, earlier)
}
