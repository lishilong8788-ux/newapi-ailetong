package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// submitInvoiceRequestForOneOrder is the shared arrangement for the lifecycle
// tests: one paid order, one company title, one pending application over it.
func submitInvoiceRequestForOneOrder(t *testing.T, userId int, topUpId int, tradeNo string) *InvoiceRequest {
	t.Helper()
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, topUpId, userId, tradeNo, 500, PaymentProviderEpay, common.TopUpStatusSuccess)
	profile := insertInvoiceTestProfile(t, userId)

	request, err := CreateInvoiceRequest(CreateInvoiceRequestParams{
		UserId:         userId,
		ProfileId:      profile.Id,
		InvoiceType:    InvoiceTypeNormal,
		RecipientEmail: "finance@example.com",
		Orders:         []InvoiceOrderRef{{SourceType: InvoiceSourceTopUp, SourceId: topUpId}},
	})
	require.NoError(t, err)

	orders, err := GetInvoiceableOrders(userId)
	require.NoError(t, err)
	require.Empty(t, orders, "the order must leave the pool while an application holds it")
	return request
}

// A rejected application must release its orders: the customer has to be able to
// fix the title and apply again. Nothing else does this, because the unique index
// on (source_type, source_id) would otherwise refuse the second application
// forever.
func TestRejectInvoiceRequest_ReleasesOrders(t *testing.T) {
	userId := 9201
	request := submitInvoiceRequestForOneOrder(t, userId, 9201001, "inv-reject-release")

	require.NoError(t, RejectInvoiceRequest(request.Id, 1, "tax number does not match"))

	orders, err := GetInvoiceableOrders(userId)
	require.NoError(t, err)
	require.Len(t, orders, 1)
	assert.Equal(t, "inv-reject-release", orders[0].TradeNo)

	reloaded, err := GetInvoiceRequestById(request.Id, userId)
	require.NoError(t, err)
	assert.Equal(t, InvoiceStatusRejected, reloaded.Status)
	assert.Equal(t, "tax number does not match", reloaded.RejectReason)
	// The order numbers stay readable after the items are gone.
	assert.Equal(t, "inv-reject-release", reloaded.TradeNoSnapshot)

	// Releasing must be complete enough for a second application to succeed.
	profile := insertInvoiceTestProfile(t, userId)
	retry, err := CreateInvoiceRequest(CreateInvoiceRequestParams{
		UserId:         userId,
		ProfileId:      profile.Id,
		InvoiceType:    InvoiceTypeNormal,
		RecipientEmail: "finance@example.com",
		Orders:         []InvoiceOrderRef{{SourceType: InvoiceSourceTopUp, SourceId: 9201001}},
	})
	require.NoError(t, err)
	assert.Equal(t, InvoiceStatusPending, retry.Status)
}

// A withdrawn application releases its orders the same way a rejected one does.
func TestCancelInvoiceRequest_ReleasesOrders(t *testing.T) {
	userId := 9202
	request := submitInvoiceRequestForOneOrder(t, userId, 9202001, "inv-cancel-release")

	require.NoError(t, CancelInvoiceRequest(request.Id, userId))

	orders, err := GetInvoiceableOrders(userId)
	require.NoError(t, err)
	require.Len(t, orders, 1)
	assert.Equal(t, "inv-cancel-release", orders[0].TradeNo)

	reloaded, err := GetInvoiceRequestById(request.Id, userId)
	require.NoError(t, err)
	assert.Equal(t, InvoiceStatusCancelled, reloaded.Status)
}

// Issuing must NOT release the orders. An issued invoice is a filed tax document;
// letting the order return to the pool would let the customer invoice the same
// payment twice.
func TestIssueInvoiceRequest_KeepsOrdersClaimed(t *testing.T) {
	userId := 9203
	request := submitInvoiceRequestForOneOrder(t, userId, 9203001, "inv-issue-keep")

	require.NoError(t, IssueInvoiceRequest(request.Id, 1, "24417000000012345678", "https://invoice.example.com/a.pdf", 0))

	orders, err := GetInvoiceableOrders(userId)
	require.NoError(t, err)
	assert.Empty(t, orders)

	reloaded, err := GetInvoiceRequestById(request.Id, userId)
	require.NoError(t, err)
	assert.Equal(t, InvoiceStatusIssued, reloaded.Status)
	assert.Equal(t, "24417000000012345678", reloaded.InvoiceNo)
	assert.Equal(t, "https://invoice.example.com/a.pdf", reloaded.PdfUrl)
	assert.Positive(t, reloaded.IssueTime, "issue time must default to now when the admin leaves the date blank")
}

// An already-issued application must not be issued or rejected a second time,
// otherwise a filed invoice number could be silently overwritten.
func TestInvoiceRequestTransitions_RejectTerminalStates(t *testing.T) {
	userId := 9204
	request := submitInvoiceRequestForOneOrder(t, userId, 9204001, "inv-terminal")

	require.NoError(t, IssueInvoiceRequest(request.Id, 1, "24417000000087654321", "https://invoice.example.com/b.pdf", 0))

	require.ErrorIs(t, IssueInvoiceRequest(request.Id, 1, "24417000000099999999", "https://invoice.example.com/c.pdf", 0), ErrInvoiceStatusInvalid)
	require.ErrorIs(t, RejectInvoiceRequest(request.Id, 1, "changed my mind"), ErrInvoiceStatusInvalid)
	require.ErrorIs(t, CancelInvoiceRequest(request.Id, userId), ErrInvoiceStatusInvalid)

	reloaded, err := GetInvoiceRequestById(request.Id, userId)
	require.NoError(t, err)
	assert.Equal(t, "24417000000087654321", reloaded.InvoiceNo)
}

// A user must not be able to withdraw somebody else's application.
func TestCancelInvoiceRequest_RejectsForeignUser(t *testing.T) {
	ownerId := 9205
	attackerId := 9206
	request := submitInvoiceRequestForOneOrder(t, ownerId, 9205001, "inv-foreign-cancel")
	insertInvoiceTestUser(t, attackerId)

	require.ErrorIs(t, CancelInvoiceRequest(request.Id, attackerId), ErrInvoiceRequestNotFound)

	reloaded, err := GetInvoiceRequestById(request.Id, ownerId)
	require.NoError(t, err)
	assert.Equal(t, InvoiceStatusPending, reloaded.Status)
}
