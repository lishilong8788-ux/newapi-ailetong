package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// submitInvoiceRequestForTopUp applies for one specific top-up and returns the
// application, so a test can then drive it to any terminal state.
func submitInvoiceRequestForTopUp(t *testing.T, userId int, topUpId int) *InvoiceRequest {
	t.Helper()
	profile := insertInvoiceTestProfile(t, userId)
	request, err := CreateInvoiceRequest(CreateInvoiceRequestParams{
		UserId:         userId,
		ProfileId:      profile.Id,
		InvoiceType:    InvoiceTypeNormal,
		RecipientEmail: "finance@example.com",
		Orders:         []InvoiceOrderRef{{SourceType: InvoiceSourceTopUp, SourceId: topUpId}},
	})
	require.NoError(t, err)
	return request
}

// requireSingleSummary asserts the user's position collapses to one currency and
// returns it.
func requireSingleSummary(t *testing.T, userId int, currency string) *InvoiceAmountSummary {
	t.Helper()
	summaries, err := GetUserInvoiceAmountSummary(userId)
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	require.Equal(t, currency, summaries[0].Currency)
	return summaries[0]
}

// The three figures on the invoice page are buckets over the same set of orders,
// so the same payment must never appear in two of them: that would let a customer
// read a total larger than what they actually paid.
func TestGetUserInvoiceAmountSummary_BucketsAreDisjoint(t *testing.T) {
	userId := 9301
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, 9301001, userId, "inv-sum-pending", 100, PaymentProviderEpay, common.TopUpStatusSuccess)
	insertInvoiceTestTopUp(t, 9301002, userId, "inv-sum-issued", 200, PaymentProviderEpay, common.TopUpStatusSuccess)
	insertInvoiceTestTopUp(t, 9301003, userId, "inv-sum-free", 400, PaymentProviderEpay, common.TopUpStatusSuccess)

	submitInvoiceRequestForTopUp(t, userId, 9301001)
	issued := submitInvoiceRequestForTopUp(t, userId, 9301002)
	require.NoError(t, IssueInvoiceRequest(issued.Id, 1, "24417000000011112222", "https://invoice.example.com/sum.pdf", 0))

	summary := requireSingleSummary(t, userId, "CNY")
	assert.EqualValues(t, 10000, summary.PendingMinor)
	assert.EqualValues(t, 20000, summary.IssuedMinor)
	assert.EqualValues(t, 40000, summary.InvoiceableMinor)
}

// Rejecting releases the order, so its amount has to move back out of pending and
// into invoiceable. If it stayed in pending the customer would see money they can
// no longer act on; if it landed in both, the page would overstate their total.
func TestGetUserInvoiceAmountSummary_RejectionReturnsAmountToInvoiceable(t *testing.T) {
	userId := 9303
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, 9303001, userId, "inv-sum-rejected", 250, PaymentProviderEpay, common.TopUpStatusSuccess)

	request := submitInvoiceRequestForTopUp(t, userId, 9303001)
	before := requireSingleSummary(t, userId, "CNY")
	require.EqualValues(t, 25000, before.PendingMinor)
	require.EqualValues(t, 0, before.InvoiceableMinor)

	_, err := RejectInvoiceRequest(request.Id, 1, "tax number does not match")
	require.NoError(t, err)

	after := requireSingleSummary(t, userId, "CNY")
	assert.EqualValues(t, 0, after.PendingMinor)
	assert.EqualValues(t, 0, after.IssuedMinor)
	assert.EqualValues(t, 25000, after.InvoiceableMinor)
}

// Currencies must stay in separate entries. Adding USD cents to CNY 分 would
// produce a figure that means nothing, and the page renders each entry with its
// own symbol.
func TestGetUserInvoiceAmountSummary_SplitsByCurrency(t *testing.T) {
	userId := 9304
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, 9304001, userId, "inv-sum-cny", 100, PaymentProviderEpay, common.TopUpStatusSuccess)
	insertInvoiceTestTopUp(t, 9304002, userId, "inv-sum-usd", 70, PaymentProviderStripe, common.TopUpStatusSuccess)

	summaries, err := GetUserInvoiceAmountSummary(userId)
	require.NoError(t, err)
	require.Len(t, summaries, 2)

	// Ordered by currency code so the UI renders stable rows.
	assert.Equal(t, "CNY", summaries[0].Currency)
	assert.EqualValues(t, 10000, summaries[0].InvoiceableMinor)
	assert.Equal(t, "USD", summaries[1].Currency)
	assert.EqualValues(t, 7000, summaries[1].InvoiceableMinor)
}

// A user with no payments and no applications gets an empty list, which the page
// renders as a single zeroed row rather than as an error.
func TestGetUserInvoiceAmountSummary_EmptyForNewUser(t *testing.T) {
	userId := 9305
	insertInvoiceTestUser(t, userId)

	summaries, err := GetUserInvoiceAmountSummary(userId)
	require.NoError(t, err)
	assert.Empty(t, summaries)
}
