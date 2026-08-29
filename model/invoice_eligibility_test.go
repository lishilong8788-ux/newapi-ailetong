package model

import (
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func insertInvoiceTestUser(t *testing.T, id int) {
	t.Helper()
	// AffCode carries a unique index, so it cannot be left empty for more than
	// one fixture user.
	require.NoError(t, DB.Create(&User{
		Id:       id,
		Username: "invoice_user_" + strconv.Itoa(id),
		AffCode:  "invaff" + strconv.Itoa(id),
		Status:   common.UserStatusEnabled,
	}).Error)
}

func insertInvoiceTestTopUp(t *testing.T, id int, userId int, tradeNo string, money float64, provider string, status string) {
	t.Helper()
	require.NoError(t, DB.Create(&TopUp{
		Id:              id,
		UserId:          userId,
		Amount:          int64(money),
		Money:           money,
		TradeNo:         tradeNo,
		PaymentMethod:   "alipay",
		PaymentProvider: provider,
		CreateTime:      common.GetTimestamp(),
		CompleteTime:    common.GetTimestamp(),
		Status:          status,
	}).Error)
}

func insertInvoiceTestProfile(t *testing.T, userId int) *InvoiceProfile {
	t.Helper()
	profile := &InvoiceProfile{
		UserId:      userId,
		TitleType:   InvoiceTitleTypeCompany,
		Title:       "Some Tech Co Ltd",
		TaxNo:       "91110108XXXXXXXXY2",
		Address:     "Beijing",
		Phone:       "010-12345678",
		BankName:    "Some Bank",
		BankAccount: "1234567890123456",
	}
	require.NoError(t, profile.Insert())
	return profile
}

// A paid order must leave the invoiceable pool once an invoice request claims
// it, otherwise a customer could invoice the same payment twice.
func TestGetInvoiceableOrders_ExcludesAlreadyInvoiced(t *testing.T) {
	const userId = 9101
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, 9101001, userId, "inv-elig-a", 500, PaymentProviderEpay, common.TopUpStatusSuccess)
	insertInvoiceTestTopUp(t, 9101002, userId, "inv-elig-b", 300, PaymentProviderEpay, common.TopUpStatusSuccess)
	profile := insertInvoiceTestProfile(t, userId)

	before, err := GetInvoiceableOrders(userId)
	require.NoError(t, err)
	require.Len(t, before, 2)

	_, err = CreateInvoiceRequest(CreateInvoiceRequestParams{
		UserId:         userId,
		ProfileId:      profile.Id,
		InvoiceType:    InvoiceTypeNormal,
		RecipientEmail: "finance@example.com",
		Orders:         []InvoiceOrderRef{{SourceType: InvoiceSourceTopUp, SourceId: 9101001}},
	})
	require.NoError(t, err)

	after, err := GetInvoiceableOrders(userId)
	require.NoError(t, err)
	require.Len(t, after, 1)
	assert.Equal(t, "inv-elig-b", after[0].TradeNo)
}

// Pending orders were never paid, so they are not invoiceable.
func TestGetInvoiceableOrders_ExcludesUnpaidOrders(t *testing.T) {
	const userId = 9102
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, 9102001, userId, "inv-unpaid", 500, PaymentProviderEpay, common.TopUpStatusPending)

	orders, err := GetInvoiceableOrders(userId)
	require.NoError(t, err)
	assert.Empty(t, orders)
}

// Two submissions naming the same order must not both succeed. The unique index
// on (source_type, source_id) is the authority here, not the pre-check.
func TestCreateInvoiceRequest_RejectsAlreadyClaimedOrder(t *testing.T) {
	const userId = 9103
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, 9103001, userId, "inv-dup", 500, PaymentProviderEpay, common.TopUpStatusSuccess)
	profile := insertInvoiceTestProfile(t, userId)

	params := CreateInvoiceRequestParams{
		UserId:         userId,
		ProfileId:      profile.Id,
		InvoiceType:    InvoiceTypeNormal,
		RecipientEmail: "finance@example.com",
		Orders:         []InvoiceOrderRef{{SourceType: InvoiceSourceTopUp, SourceId: 9103001}},
	}
	_, err := CreateInvoiceRequest(params)
	require.NoError(t, err)

	_, err = CreateInvoiceRequest(params)
	require.ErrorIs(t, err, ErrInvoiceOrderTaken)
}

// A user must not be able to invoice somebody else's payment by guessing an id.
func TestCreateInvoiceRequest_RejectsForeignOrder(t *testing.T) {
	const ownerId = 9104
	const attackerId = 9105
	insertInvoiceTestUser(t, ownerId)
	insertInvoiceTestUser(t, attackerId)
	insertInvoiceTestTopUp(t, 9104001, ownerId, "inv-foreign", 500, PaymentProviderEpay, common.TopUpStatusSuccess)
	attackerProfile := insertInvoiceTestProfile(t, attackerId)

	_, err := CreateInvoiceRequest(CreateInvoiceRequestParams{
		UserId:         attackerId,
		ProfileId:      attackerProfile.Id,
		InvoiceType:    InvoiceTypeNormal,
		RecipientEmail: "attacker@example.com",
		Orders:         []InvoiceOrderRef{{SourceType: InvoiceSourceTopUp, SourceId: 9104001}},
	})
	require.ErrorIs(t, err, ErrInvoiceOrderNotEligible)
}

// One invoice states one currency. Mixing a CNY and a USD order would make the
// stated total meaningless, so the submission must be refused outright.
func TestCreateInvoiceRequest_RejectsMixedCurrency(t *testing.T) {
	const userId = 9106
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, 9106001, userId, "inv-cny", 500, PaymentProviderEpay, common.TopUpStatusSuccess)
	insertInvoiceTestTopUp(t, 9106002, userId, "inv-usd", 70, PaymentProviderStripe, common.TopUpStatusSuccess)
	profile := insertInvoiceTestProfile(t, userId)

	_, err := CreateInvoiceRequest(CreateInvoiceRequestParams{
		UserId:         userId,
		ProfileId:      profile.Id,
		InvoiceType:    InvoiceTypeNormal,
		RecipientEmail: "finance@example.com",
		Orders: []InvoiceOrderRef{
			{SourceType: InvoiceSourceTopUp, SourceId: 9106001},
			{SourceType: InvoiceSourceTopUp, SourceId: 9106002},
		},
	})
	require.ErrorIs(t, err, ErrInvoiceCurrencyMixed)
}

// The invoiced total is stored in minor units and must sum exactly. 19.99 and
// 0.01 are chosen because they drift under float accumulation.
func TestCreateInvoiceRequest_TotalsInMinorUnits(t *testing.T) {
	const userId = 9107
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, 9107001, userId, "inv-sum-a", 19.99, PaymentProviderEpay, common.TopUpStatusSuccess)
	insertInvoiceTestTopUp(t, 9107002, userId, "inv-sum-b", 0.01, PaymentProviderEpay, common.TopUpStatusSuccess)
	profile := insertInvoiceTestProfile(t, userId)

	request, err := CreateInvoiceRequest(CreateInvoiceRequestParams{
		UserId:         userId,
		ProfileId:      profile.Id,
		InvoiceType:    InvoiceTypeNormal,
		RecipientEmail: "finance@example.com",
		Orders: []InvoiceOrderRef{
			{SourceType: InvoiceSourceTopUp, SourceId: 9107001},
			{SourceType: InvoiceSourceTopUp, SourceId: 9107002},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, int64(2000), request.AmountTotal)
	assert.Equal(t, "CNY", request.Currency)
	assert.Equal(t, InvoiceStatusPending, request.Status)
	// The title must be snapshotted, not referenced.
	assert.Equal(t, profile.Title, request.Title)
	assert.Equal(t, profile.TaxNo, request.TaxNo)
}

// A special invoice is only valid with payee bank details on the title.
func TestCreateInvoiceRequest_SpecialRequiresBankDetails(t *testing.T) {
	const userId = 9108
	insertInvoiceTestUser(t, userId)
	insertInvoiceTestTopUp(t, 9108001, userId, "inv-special", 500, PaymentProviderEpay, common.TopUpStatusSuccess)

	profile := &InvoiceProfile{
		UserId:    userId,
		TitleType: InvoiceTitleTypeCompany,
		Title:     "No Bank Co Ltd",
		TaxNo:     "91110108XXXXXXXXY3",
	}
	require.NoError(t, profile.Insert())

	_, err := CreateInvoiceRequest(CreateInvoiceRequestParams{
		UserId:         userId,
		ProfileId:      profile.Id,
		InvoiceType:    InvoiceTypeSpecial,
		RecipientEmail: "finance@example.com",
		Orders:         []InvoiceOrderRef{{SourceType: InvoiceSourceTopUp, SourceId: 9108001}},
	})
	require.ErrorIs(t, err, ErrInvoiceBankRequired)
}
