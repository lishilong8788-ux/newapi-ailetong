package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupAgentPrivacyFixture seeds one agent with one invited customer whose
// contact details are deliberately distinctive, so a test can assert on the raw
// response body that they never leave the server.
func setupAgentPrivacyFixture(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := model.DB
	previousEnabled := setting.AgentEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.AgentProfile{}, &model.AgentCommission{}, &model.AgentWithdrawal{}))
	model.DB = db
	setting.AgentEnabled = true
	t.Cleanup(func() {
		model.DB = previousDB
		setting.AgentEnabled = previousEnabled
	})

	accessToken := "customer-access-token-value"
	require.NoError(t, db.Create(&model.User{
		Id: 1, Username: "agent-one", Password: "unused", AffCode: "agt1",
		Status: common.UserStatusEnabled, Group: "default",
	}).Error)
	require.NoError(t, db.Create(&model.User{
		Id: 2, Username: "customer-one", Password: "unused", AffCode: "cst1",
		DisplayName: "Customer One", Email: "customer-secret@example.com",
		AccessToken: &accessToken, InviterId: 1, Quota: 900, UsedQuota: 120,
		Status: common.UserStatusEnabled, Group: "default",
	}).Error)
	require.NoError(t, db.Create(&model.AgentCommission{
		AgentUserId: 1, FromUserId: 2, SourceType: model.CommissionSourceTopUp, SourceId: 11,
		BaseAmount: 200, Rate: 0.05, Amount: 10, Status: model.CommissionStatusSettled,
	}).Error)
	return db
}

// TestGetAgentCustomersOmitsContactDetails locks design doc 13.2: an agent is an
// external partner and must never receive a customer's email or API credentials.
// The assertion is on the serialized body rather than on a struct field, because
// the leak this guards against is a widened SELECT, not a wrong field name.
func TestGetAgentCustomersOmitsContactDetails(t *testing.T) {
	setupAgentPrivacyFixture(t)

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/agent/customers", nil)
	c.Set("id", 1)

	GetAgentCustomers(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	body := recorder.Body.String()
	assert.NotContains(t, body, "customer-secret@example.com")
	assert.NotContains(t, body, "customer-access-token-value")

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Total int                 `json:"total"`
			Items []*AgentCustomerRow `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Equal(t, 1, response.Data.Total)
	require.Len(t, response.Data.Items, 1)
	row := response.Data.Items[0]
	assert.Equal(t, 2, row.Id)
	assert.Equal(t, "customer-one", row.Username)
	// Usage comes from users.used_quota, never from an aggregation over logs.
	assert.Equal(t, 120, row.UsedQuota)
	assert.Equal(t, 900, row.Quota)
	assert.Equal(t, 200.0, row.TopupTotal)
	assert.Equal(t, 10.0, row.CommissionTotal)
}

// TestAgentBankAccountMasking locks design doc 13.3: the agent's own view and the
// admin list expose only the last 4 digits. The full account has exactly one
// reader, the admin withdrawal detail that finance pays from.
func TestAgentBankAccountMasking(t *testing.T) {
	db := setupAgentPrivacyFixture(t)
	require.NoError(t, db.Create(&model.AgentProfile{
		UserId: 1, AgentType: model.AgentTypePersonal, Status: model.AgentStatusActive,
		SubjectName: "Agent One", BankName: "Test Bank", BankAccount: "6222020101234567890",
		Remark: "internal-operations-note",
	}).Error)

	gin.SetMode(gin.TestMode)

	selfRecorder := httptest.NewRecorder()
	selfContext, _ := gin.CreateTestContext(selfRecorder)
	selfContext.Request = httptest.NewRequest(http.MethodGet, "/api/agent/profile", nil)
	selfContext.Set("id", 1)
	GetAgentProfile(selfContext)

	require.Equal(t, http.StatusOK, selfRecorder.Code)
	selfBody := selfRecorder.Body.String()
	assert.NotContains(t, selfBody, "6222020101234567890")
	assert.Contains(t, selfBody, "7890")
	// The operators' remark is about the agent, not for the agent.
	assert.NotContains(t, selfBody, "internal-operations-note")

	adminRecorder := httptest.NewRecorder()
	adminContext, _ := gin.CreateTestContext(adminRecorder)
	adminContext.Request = httptest.NewRequest(http.MethodGet, "/api/agent/admin/profiles", nil)
	adminContext.Set("id", 1)
	AdminGetAgentProfiles(adminContext)

	require.Equal(t, http.StatusOK, adminRecorder.Code)
	assert.NotContains(t, adminRecorder.Body.String(), "6222020101234567890")
	assert.Contains(t, adminRecorder.Body.String(), "7890")
}

// TestAdminGetAgentAnalyticsShape pins the analytics contract the console renders
// against, and exercises the aggregate SQL - the COUNT(DISTINCT CASE WHEN ...)
// paying-customer count in particular - on a real database rather than trusting
// that it parses on all three dialects.
func TestAdminGetAgentAnalyticsShape(t *testing.T) {
	db := setupAgentPrivacyFixture(t)
	require.NoError(t, db.Create(&model.AgentProfile{
		UserId: 1, AgentType: model.AgentTypePersonal, Status: model.AgentStatusActive,
	}).Error)
	// A second agent with no ledger rows: every ratio on its row divides by zero
	// and must come back as 0 rather than NaN, which would not even serialize.
	require.NoError(t, db.Create(&model.User{
		Id: 3, Username: "agent-two", Password: "unused", AffCode: "agt2",
		Status: common.UserStatusEnabled, Group: "default",
	}).Error)
	require.NoError(t, db.Create(&model.AgentProfile{
		UserId: 3, AgentType: model.AgentTypeCompany, Status: model.AgentStatusPending,
	}).Error)

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/agent/admin/analytics", nil)
	c.Set("id", 1)

	AdminGetAgentAnalytics(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Overview struct {
				AgentTotal      int64            `json:"agent_total"`
				AgentActive     int64            `json:"agent_active"`
				AgentsByStatus  map[string]int64 `json:"agents_by_status"`
				CustomerTotal   int64            `json:"customer_total"`
				PayingCustomers int64            `json:"paying_customers"`
				PayingRate      float64          `json:"paying_rate"`
				PromotedRevenue float64          `json:"promoted_revenue"`
				CommissionPaid  float64          `json:"commission_paid"`
				EffectiveRate   float64          `json:"effective_rate"`
				PendingPayout   float64          `json:"pending_payout"`
			} `json:"overview"`
			Trend  []*AgentDailyBucket  `json:"trend"`
			Agents []*AgentAnalyticsRow `json:"agents"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)

	overview := response.Data.Overview
	assert.Equal(t, int64(2), overview.AgentTotal)
	assert.Equal(t, int64(1), overview.AgentActive)
	assert.Equal(t, int64(1), overview.AgentsByStatus[model.AgentStatusActive])
	assert.Equal(t, int64(1), overview.AgentsByStatus[model.AgentStatusPending])
	assert.Equal(t, int64(1), overview.CustomerTotal)
	assert.Equal(t, int64(1), overview.PayingCustomers)
	assert.Equal(t, 1.0, overview.PayingRate)
	assert.Equal(t, 200.0, overview.PromotedRevenue)
	assert.Equal(t, 10.0, overview.CommissionPaid)
	assert.Equal(t, 0.05, overview.EffectiveRate)
	assert.Equal(t, 10.0, overview.PendingPayout)

	// Default window is 30 days and every day is present, so the chart does not
	// have to fill gaps itself.
	require.Len(t, response.Data.Trend, agentStatsDefaultDays)
	var trendRevenue float64
	var trendCustomers int
	for _, bucket := range response.Data.Trend {
		trendRevenue += bucket.TopupAmount
		trendCustomers += bucket.NewCustomers
	}
	assert.Equal(t, 200.0, trendRevenue)
	assert.Equal(t, 1, trendCustomers)

	require.Len(t, response.Data.Agents, 2)
	first, second := response.Data.Agents[0], response.Data.Agents[1]
	assert.Equal(t, 1, first.UserId)
	assert.Equal(t, "agent-one", first.Username)
	assert.Equal(t, int64(1), first.Customers)
	assert.Equal(t, int64(1), first.PayingCustomers)
	assert.Equal(t, 200.0, first.Revenue)
	assert.Equal(t, 200.0, first.RevenuePerCustomer)
	assert.Equal(t, 0.05, first.EffectiveRate)
	assert.Equal(t, 3, second.UserId)
	assert.Zero(t, second.Customers)
	assert.Zero(t, second.Revenue)
	assert.Zero(t, second.PayingRate)
	assert.Zero(t, second.EffectiveRate)
}

// TestAgentPromoRedirect locks the two behaviours a promo link must have: it sets
// the 30-day attribution cookie, and a code that does not resolve still lands the
// prospect on the register page instead of showing an error.
func TestAgentPromoRedirect(t *testing.T) {
	setupAgentPrivacyFixture(t)
	gin.SetMode(gin.TestMode)

	resolved := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(resolved)
	c.Request = httptest.NewRequest(http.MethodGet, "/r/agt1", nil)
	c.Params = gin.Params{{Key: "code", Value: "agt1"}}
	AgentPromoRedirect(c)

	assert.Equal(t, http.StatusFound, resolved.Code)
	assert.Equal(t, "/register?aff=agt1", resolved.Header().Get("Location"))
	assert.Equal(t, "no-store", resolved.Header().Get("Cache-Control"))
	require.NotEmpty(t, resolved.Result().Cookies())
	cookie := resolved.Result().Cookies()[0]
	assert.Equal(t, AgentPromoCookie, cookie.Name)
	assert.Equal(t, "agt1", cookie.Value)
	assert.Equal(t, agentPromoCookieMaxAge, cookie.MaxAge)

	for _, code := range []string{"nope", "../etc", "a b"} {
		unresolved := httptest.NewRecorder()
		c, _ = gin.CreateTestContext(unresolved)
		c.Request = httptest.NewRequest(http.MethodGet, "/r/x", nil)
		c.Params = gin.Params{{Key: "code", Value: code}}
		AgentPromoRedirect(c)

		assert.Equal(t, http.StatusFound, unresolved.Code, code)
		assert.Equal(t, "/register", unresolved.Header().Get("Location"), code)
		assert.Empty(t, unresolved.Result().Cookies(), code)
	}
}

// TestGetAgentCustomersKeywordAndSort covers the two query paths the list adds on
// top of the plain page: the keyword recount, which counts through the joined
// query, and the sort whitelist, which is the only thing standing between the
// sort_by parameter and the ORDER BY clause.
func TestGetAgentCustomersKeywordAndSort(t *testing.T) {
	db := setupAgentPrivacyFixture(t)
	require.NoError(t, db.Create(&model.User{
		Id: 4, Username: "customer-two", Password: "unused", AffCode: "cst2",
		InviterId: 1, Quota: 10, UsedQuota: 5,
		Status: common.UserStatusEnabled, Group: "default",
	}).Error)

	gin.SetMode(gin.TestMode)

	filtered := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(filtered)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/agent/customers?keyword=customer-two", nil)
	c.Set("id", 1)
	GetAgentCustomers(c)

	require.Equal(t, http.StatusOK, filtered.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Total int                 `json:"total"`
			Items []*AgentCustomerRow `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(filtered.Body.Bytes(), &response))
	require.True(t, response.Success)
	// The total has to reflect the keyword, otherwise the pager offers pages that
	// do not exist.
	assert.Equal(t, 1, response.Data.Total)
	require.Len(t, response.Data.Items, 1)
	assert.Equal(t, "customer-two", response.Data.Items[0].Username)

	sorted := httptest.NewRecorder()
	c, _ = gin.CreateTestContext(sorted)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/agent/customers?sort_by=topup_total&order=desc", nil)
	c.Set("id", 1)
	GetAgentCustomers(c)

	require.Equal(t, http.StatusOK, sorted.Code)
	require.NoError(t, common.Unmarshal(sorted.Body.Bytes(), &response))
	require.Len(t, response.Data.Items, 2)
	assert.Equal(t, 2, response.Data.Items[0].Id, "the paying customer sorts first")

	// An unknown sort key falls back to a stable column instead of reaching the SQL.
	assert.Equal(t, "users.id desc", agentCustomerOrder("users.email; DROP TABLE users", "desc"))
	assert.Equal(t, "users.username asc", agentCustomerOrder("username", "asc"))
}

func TestMaskBankAccount(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"", ""},
		{"12", "**"},
		{"1234", "****"},
		{"12345", "*2345"},
		{"6222020101234567890", "***************7890"},
	}
	for _, testCase := range cases {
		assert.Equal(t, testCase.expected, maskBankAccount(testCase.input), testCase.input)
	}
}
