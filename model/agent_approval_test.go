package model

import (
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// insertAgentTestUser creates the account a profile hangs off. aff_code carries a
// unique index, so it has to be distinct per fixture user.
func insertAgentTestUser(t *testing.T, id int) {
	t.Helper()
	require.NoError(t, DB.Create(&User{
		Id:       id,
		Username: "agent_user_" + strconv.Itoa(id),
		AffCode:  "agtaff" + strconv.Itoa(id),
		Status:   common.UserStatusEnabled,
	}).Error)
}

// truncateAgentTables keeps the shared in-memory database from leaking agent rows
// between tests in this package.
func truncateAgentTables(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		DB.Exec("DELETE FROM agent_commissions")
		DB.Exec("DELETE FROM agent_withdrawals")
		DB.Exec("DELETE FROM agent_profiles")
		DB.Exec("DELETE FROM users")
	})
}

func reloadAgentProfile(t *testing.T, userId int) *AgentProfile {
	t.Helper()
	profile, err := GetAgentProfileByUserId(userId)
	require.NoError(t, err)
	return profile
}

// approved_at is the switch commission accrual reads, so the first approval has
// to stamp it and no later review may move it. If a re-review could re-date the
// stamp, an operator re-checking an edited bank account would be silently
// re-admitting the agent instead of confirming them.
func TestAuditAgentProfile_StampsApprovedAtOnceOnly(t *testing.T) {
	truncateAgentTables(t)
	userId := 8101
	insertAgentTestUser(t, userId)
	require.NoError(t, DB.Create(&AgentProfile{
		UserId: userId, AgentType: AgentTypePersonal, Status: AgentStatusPending,
		SubjectName: "Agent One", IdNo: "110101199001010011",
	}).Error)

	require.NoError(t, AuditAgentProfile(reloadAgentProfile(t, userId).Id, 1, true, ""))
	firstApproval := reloadAgentProfile(t, userId)
	require.Equal(t, AgentStatusActive, firstApproval.Status)
	require.NotZero(t, firstApproval.ApprovedAt, "the first approval must record when the agent was admitted")

	// Editing an approved profile sends it back to the queue. The stamp has to
	// survive the round trip, otherwise the agent stops earning mid-review.
	_, err := SubmitAgentProfile(userId, SubmitAgentProfileParams{
		AgentType: AgentTypePersonal, SubjectName: "Agent One", IdNo: "110101199001010011",
		BankName: "Test Bank", BankAccount: "6222020101234567890",
	})
	require.NoError(t, err)
	resubmitted := reloadAgentProfile(t, userId)
	assert.Equal(t, AgentStatusPending, resubmitted.Status)
	assert.Equal(t, firstApproval.ApprovedAt, resubmitted.ApprovedAt, "a resubmission must not clear the original approval")
	assert.Zero(t, resubmitted.AuditTime, "a resubmission does clear the audit trail of the previous verdict")

	require.NoError(t, AuditAgentProfile(resubmitted.Id, 2, true, ""))
	reapproved := reloadAgentProfile(t, userId)
	assert.Equal(t, AgentStatusActive, reapproved.Status)
	assert.Equal(t, firstApproval.ApprovedAt, reapproved.ApprovedAt, "a second approval must not re-date the first")
	assert.Equal(t, 2, reapproved.AuditBy)
}

// A rejection must leave approved_at alone: for a first-time applicant it stays
// zero (they never earn), and there is no path where a rejection grants the stamp.
func TestAuditAgentProfile_RejectionLeavesApprovedAtZero(t *testing.T) {
	truncateAgentTables(t)
	userId := 8102
	insertAgentTestUser(t, userId)
	require.NoError(t, DB.Create(&AgentProfile{
		UserId: userId, AgentType: AgentTypePersonal, Status: AgentStatusPending,
		SubjectName: "Agent Two", IdNo: "110101199001010022",
	}).Error)

	require.NoError(t, AuditAgentProfile(reloadAgentProfile(t, userId).Id, 1, false, "id number does not match"))
	rejected := reloadAgentProfile(t, userId)
	assert.Equal(t, AgentStatusRejected, rejected.Status)
	assert.Zero(t, rejected.ApprovedAt)
	assert.Equal(t, "id number does not match", rejected.RejectReason)
}

// The backfill is what keeps already-approved agents earning across the upgrade
// that introduced the gate. It must reach every post-approval state and must not
// invent an approval for anyone still waiting or already rejected.
func TestBackfillAgentApprovedAt(t *testing.T) {
	truncateAgentTables(t)

	cases := []struct {
		name      string
		userId    int
		status    string
		auditTime int64
		existing  int64
	}{
		{name: "active with audit time", userId: 8201, status: AgentStatusActive, auditTime: 1700000001},
		{name: "active without audit time", userId: 8202, status: AgentStatusActive},
		{name: "suspended is a post-approval state", userId: 8203, status: AgentStatusSuspended, auditTime: 1700000003},
		{name: "pending was never approved", userId: 8204, status: AgentStatusPending, auditTime: 0},
		{name: "incomplete was never approved", userId: 8205, status: AgentStatusIncomplete},
		{name: "rejected was never approved", userId: 8206, status: AgentStatusRejected, auditTime: 1700000006},
		{name: "already stamped", userId: 8207, status: AgentStatusActive, auditTime: 1700000007, existing: 1699999999},
	}
	for _, tc := range cases {
		insertAgentTestUser(t, tc.userId)
		require.NoError(t, DB.Create(&AgentProfile{
			UserId: tc.userId, AgentType: AgentTypePersonal, Status: tc.status,
			AuditTime: tc.auditTime, ApprovedAt: tc.existing,
		}).Error)
	}

	require.NoError(t, BackfillAgentApprovedAt())

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			profile := reloadAgentProfile(t, tc.userId)
			switch {
			case tc.existing != 0:
				assert.Equal(t, tc.existing, profile.ApprovedAt, "an existing stamp must not be overwritten")
			case tc.status != AgentStatusActive && tc.status != AgentStatusSuspended:
				assert.Zero(t, profile.ApprovedAt, "a profile that never passed review must not gain an approval")
			case tc.auditTime > 0:
				assert.Equal(t, tc.auditTime, profile.ApprovedAt, "audit_time is the approval timestamp")
			default:
				// No audit trail to read: updated_at is late but never zero, and a
				// zero stamp would mean the agent silently stops earning.
				assert.NotZero(t, profile.ApprovedAt)
				assert.Equal(t, profile.UpdatedAt, profile.ApprovedAt)
			}
		})
	}

	// Rerunning on already-backfilled data must be a no-op, because it runs on
	// every process start.
	require.NoError(t, BackfillAgentApprovedAt())
	assert.Equal(t, int64(1700000001), reloadAgentProfile(t, 8201).ApprovedAt)
}

// Auto-approve skips the review queue, so SubmitAgentProfile is the moment of
// first approval on that path and has to stamp approved_at itself. Without this
// an auto-approved agent would be active yet never earn a cent.
func TestSubmitAgentProfile_AutoApproveStampsApprovedAt(t *testing.T) {
	truncateAgentTables(t)
	previous := setting.AgentAutoApprove
	setting.AgentAutoApprove = true
	t.Cleanup(func() { setting.AgentAutoApprove = previous })

	userId := 8103
	insertAgentTestUser(t, userId)

	profile, err := SubmitAgentProfile(userId, SubmitAgentProfileParams{
		AgentType: AgentTypeCompany, CompanyName: "Acme Ltd", TaxNo: "91110000MA01",
	})
	require.NoError(t, err)
	assert.Equal(t, AgentStatusActive, profile.Status)
	assert.NotZero(t, profile.ApprovedAt)
}

// PruneEmptyAgentProfiles removes the rows a historical bug created by merely
// opening the programme page. Everything it must NOT touch is enumerated here,
// because the failure mode is destroying an operator's work or an agent's money
// trail, not leaving noise behind.
func TestPruneEmptyAgentProfiles_OnlyRemovesZeroInformationRows(t *testing.T) {
	truncateAgentTables(t)
	rate := 0.08

	cases := []struct {
		name     string
		userId   int
		profile  AgentProfile
		seed     func(t *testing.T, userId int)
		survives bool
	}{
		{
			name:   "page visit noise",
			userId: 8301,
			// Exactly what EnsureAgentProfile used to insert on a GET.
			profile: AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete},
		},
		{
			name:     "has commission history",
			userId:   8302,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete},
			survives: true,
			seed: func(t *testing.T, userId int) {
				require.NoError(t, DB.Create(&AgentCommission{
					AgentUserId: userId, FromUserId: 1, SourceType: CommissionSourceTopUp, SourceId: 1,
					BaseAmount: 100, Rate: 0.05, Amount: 5, Status: CommissionStatusSettled,
				}).Error)
			},
		},
		{
			name:     "has withdrawal history",
			userId:   8303,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete},
			survives: true,
			seed: func(t *testing.T, userId int) {
				require.NoError(t, DB.Create(&AgentWithdrawal{
					AgentUserId: userId, Amount: 100, ActualAmount: 100,
					Method: WithdrawalMethodBank, Status: WithdrawalStatusPaid,
				}).Error)
			},
		},
		{
			name:     "has subject details",
			userId:   8304,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete, SubjectName: "Half Filled"},
			survives: true,
		},
		{
			name:     "has payee details",
			userId:   8305,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete, BankAccount: "6222020101234567890"},
			survives: true,
		},
		{
			name:     "has contact details",
			userId:   8306,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete, ContactPhone: "13000000000"},
			survives: true,
		},
		{
			name:     "was approved once",
			userId:   8307,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete, ApprovedAt: 1700000000},
			survives: true,
		},
		{
			name:     "was audited",
			userId:   8308,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete, AuditBy: 1},
			survives: true,
		},
		{
			name:     "carries an operator remark",
			userId:   8309,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete, Remark: "designated by sales"},
			survives: true,
		},
		{
			name:     "carries a configured rate",
			userId:   8310,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete, CommissionRate: &rate},
			survives: true,
		},
		{
			name:     "carries a rejection reason",
			userId:   8311,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete, RejectReason: "missing licence"},
			survives: true,
		},
		{
			name:     "carries an operator level label",
			userId:   8312,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusIncomplete, Level: "gold"},
			survives: true,
		},
		{
			name:     "is under review",
			userId:   8313,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusPending},
			survives: true,
		},
		{
			name:     "is active",
			userId:   8314,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusActive},
			survives: true,
		},
		{
			name:     "was rejected",
			userId:   8315,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusRejected},
			survives: true,
		},
		{
			name:     "is suspended",
			userId:   8316,
			profile:  AgentProfile{AgentType: AgentTypePersonal, Status: AgentStatusSuspended},
			survives: true,
		},
		{
			name:   "second page visit noise",
			userId: 8317,
			// A zero-information company row is noise too: agent_type alone says
			// nothing an operator typed.
			profile: AgentProfile{AgentType: AgentTypeCompany, Status: AgentStatusIncomplete},
		},
	}

	for _, tc := range cases {
		insertAgentTestUser(t, tc.userId)
		profile := tc.profile
		profile.UserId = tc.userId
		require.NoError(t, DB.Create(&profile).Error)
		if tc.seed != nil {
			tc.seed(t, tc.userId)
		}
	}

	pruned, err := PruneEmptyAgentProfiles()
	require.NoError(t, err)
	assert.Equal(t, int64(2), pruned)

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := GetAgentProfileByUserId(tc.userId)
			if tc.survives {
				require.NoError(t, err, "this row carries information and must be kept")
				return
			}
			require.ErrorIs(t, err, ErrAgentProfileNotFound)
		})
	}

	// Idempotent: it runs on every process start and there is nothing left to do.
	pruned, err = PruneEmptyAgentProfiles()
	require.NoError(t, err)
	assert.Zero(t, pruned)
}
