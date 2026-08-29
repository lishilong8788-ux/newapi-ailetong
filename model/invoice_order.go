package model

import (
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
)

// invoiceCurrencyForProvider maps a payment provider to the currency the
// customer was actually charged in. The invoice must state that currency, not a
// rate-converted figure: exchange rates move, an issued invoice may not.
func invoiceCurrencyForProvider(provider string) string {
	switch provider {
	case PaymentProviderEpay:
		return "CNY"
	default:
		return "USD"
	}
}

// invoiceAmountFromMoney converts a paid amount to minor units (分/cents).
// decimal is used rather than float arithmetic so 0.1+0.2 style drift cannot
// reach a legal document.
func invoiceAmountFromMoney(money float64) (int64, error) {
	if money <= 0 {
		return 0, ErrInvoiceAmountInvalid
	}
	cents := decimal.NewFromFloat(money).Mul(decimal.NewFromInt(100)).Round(0)
	if !cents.IsPositive() {
		return 0, ErrInvoiceAmountInvalid
	}
	return cents.IntPart(), nil
}

// takenSourceIds returns the (source_type, source_id) pairs that already belong
// to an invoice request, so they can be filtered out of the invoiceable pool.
// Cancelled and rejected requests delete their items, which is what returns
// those orders here.
func takenSourceIds(sourceType string, userId int) (map[int]struct{}, error) {
	var items []InvoiceItem
	err := DB.Model(&InvoiceItem{}).
		Select("invoice_items.source_id").
		Joins("JOIN invoice_requests ON invoice_requests.id = invoice_items.request_id").
		Where("invoice_items.source_type = ? AND invoice_requests.user_id = ?", sourceType, userId).
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	taken := make(map[int]struct{}, len(items))
	for _, item := range items {
		taken[item.SourceId] = struct{}{}
	}
	return taken, nil
}

// GetInvoiceableOrders lists the user's paid orders that can still be invoiced.
//
// This deliberately does not reuse GetUserTopUps: that helper clamps results to
// a 30-day window, while invoicing routinely covers orders from months earlier.
func GetInvoiceableOrders(userId int) ([]*InvoiceableOrder, error) {
	cutoff := invoiceableCutoff()
	orders := make([]*InvoiceableOrder, 0)

	topUpTaken, err := takenSourceIds(InvoiceSourceTopUp, userId)
	if err != nil {
		return nil, err
	}
	var topUps []TopUp
	err = DB.Where("user_id = ? AND status = ? AND complete_time >= ?",
		userId, common.TopUpStatusSuccess, cutoff).
		Order("complete_time desc").Find(&topUps).Error
	if err != nil {
		return nil, err
	}
	for _, topUp := range topUps {
		if _, exists := topUpTaken[topUp.Id]; exists {
			continue
		}
		amount, convErr := invoiceAmountFromMoney(topUp.Money)
		if convErr != nil {
			continue
		}
		orders = append(orders, &InvoiceableOrder{
			SourceType: InvoiceSourceTopUp,
			SourceId:   topUp.Id,
			TradeNo:    topUp.TradeNo,
			Amount:     amount,
			Currency:   invoiceCurrencyForProvider(topUp.PaymentProvider),
			PayTime:    topUp.CompleteTime,
		})
	}

	subTaken, err := takenSourceIds(InvoiceSourceSubscription, userId)
	if err != nil {
		return nil, err
	}
	var subOrders []SubscriptionOrder
	// Balance-paid subscriptions are excluded: the money entered the platform at
	// top-up time and was invoiceable there. Invoicing it again would double-bill
	// the same funds.
	err = DB.Where("user_id = ? AND status = ? AND complete_time >= ? AND payment_provider <> ?",
		userId, common.TopUpStatusSuccess, cutoff, PaymentProviderBalance).
		Order("complete_time desc").Find(&subOrders).Error
	if err != nil {
		return nil, err
	}
	for _, order := range subOrders {
		if _, exists := subTaken[order.Id]; exists {
			continue
		}
		amount, convErr := invoiceAmountFromMoney(order.Money)
		if convErr != nil {
			continue
		}
		orders = append(orders, &InvoiceableOrder{
			SourceType: InvoiceSourceSubscription,
			SourceId:   order.Id,
			TradeNo:    order.TradeNo,
			Amount:     amount,
			Currency:   invoiceCurrencyForProvider(order.PaymentProvider),
			PayTime:    order.CompleteTime,
		})
	}

	return orders, nil
}

// GetUserInvoiceAmountSummary totals the user's invoicing position per currency.
//
// One entry is returned per currency that carries a non-zero figure, ordered by
// currency code so the UI renders stable rows. An empty result means the user
// has no paid orders and no applications at all.
func GetUserInvoiceAmountSummary(userId int) ([]*InvoiceAmountSummary, error) {
	byCurrency := make(map[string]*InvoiceAmountSummary)
	entryFor := func(currency string) *InvoiceAmountSummary {
		code := strings.ToUpper(strings.TrimSpace(currency))
		if code == "" {
			code = defaultInvoiceCurrency
		}
		if entry, exists := byCurrency[code]; exists {
			return entry
		}
		entry := &InvoiceAmountSummary{Currency: code}
		byCurrency[code] = entry
		return entry
	}

	var claimed []struct {
		Currency string
		Status   string
		Total    int64
	}
	err := DB.Model(&InvoiceRequest{}).
		Select("currency, status, COALESCE(SUM(amount_total), 0) as total").
		Where("user_id = ? AND status IN (?)", userId,
			[]string{InvoiceStatusPending, InvoiceStatusIssued}).
		Group("currency, status").
		Scan(&claimed).Error
	if err != nil {
		return nil, err
	}
	for _, row := range claimed {
		entry := entryFor(row.Currency)
		if row.Status == InvoiceStatusIssued {
			entry.IssuedMinor += row.Total
			continue
		}
		entry.PendingMinor += row.Total
	}

	orders, err := GetInvoiceableOrders(userId)
	if err != nil {
		return nil, err
	}
	for _, order := range orders {
		entryFor(order.Currency).InvoiceableMinor += order.Amount
	}

	currencies := make([]string, 0, len(byCurrency))
	for code := range byCurrency {
		currencies = append(currencies, code)
	}
	sort.Strings(currencies)

	summaries := make([]*InvoiceAmountSummary, 0, len(currencies))
	for _, code := range currencies {
		summaries = append(summaries, byCurrency[code])
	}
	return summaries, nil
}

// LookupInvoiceableOrder re-reads one order at submission time and re-verifies
// eligibility. The list endpoint's result may be stale by the time the user
// submits, so the write path must not trust it.
func LookupInvoiceableOrder(userId int, sourceType string, sourceId int) (*InvoiceableOrder, error) {
	cutoff := invoiceableCutoff()

	switch sourceType {
	case InvoiceSourceTopUp:
		var topUp TopUp
		err := DB.Where("id = ? AND user_id = ? AND status = ? AND complete_time >= ?",
			sourceId, userId, common.TopUpStatusSuccess, cutoff).First(&topUp).Error
		if err != nil {
			return nil, ErrInvoiceOrderNotEligible
		}
		amount, convErr := invoiceAmountFromMoney(topUp.Money)
		if convErr != nil {
			return nil, ErrInvoiceOrderNotEligible
		}
		return &InvoiceableOrder{
			SourceType: InvoiceSourceTopUp,
			SourceId:   topUp.Id,
			TradeNo:    topUp.TradeNo,
			Amount:     amount,
			Currency:   invoiceCurrencyForProvider(topUp.PaymentProvider),
			PayTime:    topUp.CompleteTime,
		}, nil

	case InvoiceSourceSubscription:
		var order SubscriptionOrder
		err := DB.Where("id = ? AND user_id = ? AND status = ? AND complete_time >= ? AND payment_provider <> ?",
			sourceId, userId, common.TopUpStatusSuccess, cutoff, PaymentProviderBalance).First(&order).Error
		if err != nil {
			return nil, ErrInvoiceOrderNotEligible
		}
		amount, convErr := invoiceAmountFromMoney(order.Money)
		if convErr != nil {
			return nil, ErrInvoiceOrderNotEligible
		}
		return &InvoiceableOrder{
			SourceType: InvoiceSourceSubscription,
			SourceId:   order.Id,
			TradeNo:    order.TradeNo,
			Amount:     amount,
			Currency:   invoiceCurrencyForProvider(order.PaymentProvider),
			PayTime:    order.CompleteTime,
		}, nil
	}

	return nil, ErrInvoiceOrderNotEligible
}
