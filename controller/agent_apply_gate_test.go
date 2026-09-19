package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// agentProfileResponse is the contract the programme page renders against. The
// link fields are pointers so "absent" stays distinguishable from "empty string":
// the whole point of the gate is that an unapproved caller receives no key at all.
type agentProfileResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Profile       *model.AgentProfile `json:"profile"`
		EffectiveRate float64             `json:"effective_rate"`
		Stats         struct {
			Available     float64 `json:"available"`
			Total         float64 `json:"total"`
			Withdrawn     float64 `json:"withdrawn"`
			CustomerCount int64   `json:"customer_count"`
		} `json:"stats"`
		AffCode      *string `json:"aff_code"`
		PromoLink    *string `json:"promo_link"`
		RegisterLink *string `json:"register_link"`
		Withdrawal   struct {
			MinAmount float64 `json:"min_amount"`
			FeeRate   float64 `json:"fee_rate"`
			CanApply  bool    `json:"can_apply"`
		} `json:"withdrawal"`
		Programme struct {
			DefaultRate float64 `json:"default_rate"`
			FreezeDays  int     `json:"freeze_days"`
			AutoApprove bool    `json:"auto_approve"`
		} `json:"programme"`
	} `json:"data"`
}

func getAgentProfileAs(t *testing.T, userId int) (*httptest.ResponseRecorder, agentProfileResponse) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/agent/profile", nil)
	c.Set("id", userId)

	GetAgentProfile(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response agentProfileResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	return recorder, response
}

// Reading the programme page must not enrol anybody. This used to call
// EnsureAgentProfile, so every visitor became a row in the admin agent list, a
// data point in the analytics status breakdown, and - because accrual only
// checked for "not suspended" - an inviter who earned commission.
func TestGetAgentProfile_WithoutProfileCreatesNothing(t *testing.T) {
	db := setupAgentPrivacyFixture(t)

	_, response := getAgentProfileAs(t, 1)

	assert.Nil(t, response.Data.Profile, "a visitor has no profile until they apply")
	var profiles int64
	require.NoError(t, db.Model(&model.AgentProfile{}).Count(&profiles).Error)
	assert.Zero(t, profiles, "reading the page must not insert a profile row")

	// No promotion identity is issued before approval, not even a generated one.
	assert.Nil(t, response.Data.AffCode)
	assert.Nil(t, response.Data.PromoLink)
	assert.Nil(t, response.Data.RegisterLink)
	assert.False(t, response.Data.Withdrawal.CanApply)

	// Stats are zeroed rather than aggregated: there is nothing to aggregate.
	assert.Zero(t, response.Data.Stats.Available)
	assert.Zero(t, response.Data.Stats.Total)
	assert.Zero(t, response.Data.Stats.Withdrawn)
	assert.Zero(t, response.Data.Stats.CustomerCount)

	// The application form needs the terms it is asking the user to accept.
	assert.Equal(t, setting.EffectiveCommissionRate(nil), response.Data.Programme.DefaultRate)
	assert.Equal(t, setting.AgentFreezeDays, response.Data.Programme.FreezeDays)
	assert.Equal(t, setting.AgentAutoApprove, response.Data.Programme.AutoApprove)
}

// A user with an aff_code from the pre-existing affiliate programme still must
// not be handed a distributor promo link before approval - the two programmes
// share the code but not the entitlement.
func TestGetAgentProfile_UnapprovedStatusesGetNoPromoLink(t *testing.T) {
	cases := []struct {
		status     string
		approvedAt int64
		hasLink    bool
	}{
		{status: model.AgentStatusIncomplete},
		{status: model.AgentStatusPending},
		{status: model.AgentStatusRejected},
		// active and suspended are the post-approval states. A suspended agent keeps
		// the link so the customers they already invited stay attributable.
		{status: model.AgentStatusActive, approvedAt: 1700000000, hasLink: true},
		{status: model.AgentStatusSuspended, approvedAt: 1700000000, hasLink: true},
	}

	for _, tc := range cases {
		t.Run(tc.status, func(t *testing.T) {
			db := setupAgentPrivacyFixture(t)
			require.NoError(t, db.Create(&model.AgentProfile{
				UserId: 1, AgentType: model.AgentTypePersonal, Status: tc.status, ApprovedAt: tc.approvedAt,
			}).Error)

			_, response := getAgentProfileAs(t, 1)
			require.NotNil(t, response.Data.Profile)
			assert.Equal(t, tc.status, response.Data.Profile.Status)

			if !tc.hasLink {
				assert.Nil(t, response.Data.AffCode, tc.status)
				assert.Nil(t, response.Data.PromoLink, tc.status)
				assert.Nil(t, response.Data.RegisterLink, tc.status)
				return
			}
			require.NotNil(t, response.Data.AffCode)
			assert.Equal(t, "agt1", *response.Data.AffCode)
			require.NotNil(t, response.Data.PromoLink)
			assert.Contains(t, *response.Data.PromoLink, "/r/agt1")
			require.NotNil(t, response.Data.RegisterLink)
			assert.Contains(t, *response.Data.RegisterLink, "aff=agt1")
			assert.Equal(t, tc.status == model.AgentStatusActive, response.Data.Withdrawal.CanApply)
		})
	}
}

// An applicant under review must not have an aff code minted for them as a side
// effect of loading the page. The code is the platform's promotion identity, and
// issuing one is a decision that belongs to approval.
func TestGetAgentProfile_PendingDoesNotMintAffCode(t *testing.T) {
	db := setupAgentPrivacyFixture(t)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", 1).Update("aff_code", "").Error)
	require.NoError(t, db.Create(&model.AgentProfile{
		UserId: 1, AgentType: model.AgentTypePersonal, Status: model.AgentStatusPending,
	}).Error)

	_, response := getAgentProfileAs(t, 1)
	assert.Nil(t, response.Data.PromoLink)

	var user model.User
	require.NoError(t, db.Where("id = ?", 1).First(&user).Error)
	assert.Empty(t, user.AffCode, "no promotion code is generated before approval")
}

// The agent-side list endpoints back the same page as the profile call, so an
// applicant with no profile has to read as empty rather than as an error - a red
// toast on the application form would look like the application failed.
func TestAgentListEndpointsWithoutProfileReturnEmpty(t *testing.T) {
	db := setupAgentPrivacyFixture(t)
	require.NoError(t, db.Create(&model.User{
		Id: 3, Username: "applicant", Password: "unused", AffCode: "app1",
		Status: common.UserStatusEnabled, Group: "default",
	}).Error)
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name    string
		target  string
		handler gin.HandlerFunc
	}{
		{name: "customers", target: "/api/agent/customers", handler: GetAgentCustomers},
		{name: "commissions", target: "/api/agent/commissions", handler: GetAgentCommissions},
		{name: "withdrawals", target: "/api/agent/withdrawals", handler: GetAgentWithdrawals},
		{name: "stats", target: "/api/agent/stats", handler: GetAgentStats},
		{name: "customers export", target: "/api/agent/customers/export", handler: GetAgentCustomersExport},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodGet, tc.target, nil)
			// User 3 has no profile and no customers.
			c.Set("id", 3)

			tc.handler(c)

			require.Equal(t, http.StatusOK, recorder.Code)
			if tc.name == "customers export" {
				// CSV, not the JSON envelope: a header row and nothing else.
				assert.Contains(t, recorder.Body.String(), "用户ID")
				return
			}
			var body struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &body))
			assert.True(t, body.Success, tc.target)
		})
	}
}
