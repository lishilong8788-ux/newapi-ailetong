package model

import (
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// submitInvoiceRequestForOrderAt submits one application for a single order
// whose completion time is fixed, so the pay-time snapshot is assertable.
func submitInvoiceRequestForOrderAt(t *testing.T, userId int, topUpId int, tradeNo string, paidAt int64) *InvoiceRequest {
	t.Helper()
	insertInvoiceTestUser(t, userId)
	require.NoError(t, DB.Create(&TopUp{
		Id:              topUpId,
		UserId:          userId,
		Amount:          500,
		Money:           500,
		TradeNo:         tradeNo,
		PaymentMethod:   "alipay",
		PaymentProvider: PaymentProviderEpay,
		CreateTime:      paidAt - 60,
		CompleteTime:    paidAt,
		Status:          common.TopUpStatusSuccess,
	}).Error)
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

// The breakdown shown to finance states when each invoiced order was paid. The
// time must be a snapshot on the item: reading it from the order at view time
// would break once the order is purged or its row changes.
func TestInvoiceItemSnapshotsPayTime(t *testing.T) {
	userId := 9401
	paidAt := time.Date(2026, 8, 25, 10, 30, 0, 0, time.UTC).Unix()
	request := submitInvoiceRequestForOrderAt(t, userId, 9401001, "inv-pay-time", paidAt)

	items, err := GetInvoiceRequestItems(request.Id)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, paidAt, items[0].PayTime)
}

// The admin list must name the applicant: a bare numeric id forces the operator
// to look up every row by hand before acting on it.
func TestGetAllInvoiceRequests_ReturnsUsername(t *testing.T) {
	ownerId := 9402
	otherId := 9403
	request := submitInvoiceRequestForOneOrder(t, ownerId, 9402001, "inv-admin-owner")
	other := submitInvoiceRequestForOneOrder(t, otherId, 9402002, "inv-admin-other")

	requests, total, err := GetAllInvoiceRequests("", "", &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.True(t, total >= 2)

	usernameByRequestId := make(map[int]string, len(requests))
	for _, row := range requests {
		usernameByRequestId[row.Id] = row.Username
	}
	assert.Equal(t, "invoice_user_"+strconv.Itoa(ownerId), usernameByRequestId[request.Id])
	assert.Equal(t, "invoice_user_"+strconv.Itoa(otherId), usernameByRequestId[other.Id])
}

// The status filter must keep working under the join, and a keyword must not
// leak into the users table: searching a username should not match anything.
func TestGetAllInvoiceRequests_FilterAndKeywordScopes(t *testing.T) {
	userId := 9404
	request := submitInvoiceRequestForOneOrder(t, userId, 9404001, "inv-admin-scope")

	_, issuedTotal, err := GetAllInvoiceRequests(InvoiceStatusIssued, "", &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Zero(t, issuedTotal)

	pending, total, err := GetAllInvoiceRequests(InvoiceStatusPending, "", &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.NotZero(t, total)
	found := false
	for _, row := range pending {
		found = found || row.Id == request.Id
	}
	assert.True(t, found)

	_, total, err = GetAllInvoiceRequests("", "invoice_user_"+strconv.Itoa(userId), &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Zero(t, total, "the keyword must search invoice columns, not usernames")
}
