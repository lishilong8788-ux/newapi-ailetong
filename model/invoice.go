package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
)

// Invoice request status machine:
//
//	pending ──► issued
//	   │        (terminal)
//	   ├──► rejected  (admin declined; items released)
//	   └──► cancelled (user withdrew; items released)
//
// Releasing items means deleting the InvoiceItem rows so the underlying orders
// return to the invoiceable pool. A partial unique index on a status column
// would be the alternative, but PostgreSQL-only syntax breaks the MySQL/SQLite
// compatibility requirement.
const (
	InvoiceStatusPending   = "pending"
	InvoiceStatusIssued    = "issued"
	InvoiceStatusRejected  = "rejected"
	InvoiceStatusCancelled = "cancelled"
)

// Invoice kind. Special (增值税专用发票) additionally requires bank details.
const (
	InvoiceTypeNormal  = "normal"
	InvoiceTypeSpecial = "special"
)

// Invoice title owner kind.
const (
	InvoiceTitleTypePersonal = "personal"
	InvoiceTitleTypeCompany  = "company"
)

// Order kinds that can be invoiced.
const (
	InvoiceSourceTopUp        = "topup"
	InvoiceSourceSubscription = "subscription"
)

// defaultInvoiceCurrency matches the column default and is the fallback when a
// stored row predates the currency column being populated.
const defaultInvoiceCurrency = "CNY"

// invoiceableWindowSeconds bounds how far back orders stay invoiceable. Chinese
// tax practice generally keeps the current fiscal year open, so a 12-month
// window is used instead of the 30-day window that TopUp history queries apply.
const invoiceableWindowSeconds int64 = 365 * 24 * 60 * 60

func invoiceableCutoff() int64 {
	return common.GetTimestamp() - invoiceableWindowSeconds
}

var (
	ErrInvoiceProfileNotFound  = errors.New("invoice profile not found")
	ErrInvoiceRequestNotFound  = errors.New("invoice request not found")
	ErrInvoiceStatusInvalid    = errors.New("invoice request status invalid")
	ErrInvoiceNoOrders         = errors.New("no orders selected")
	ErrInvoiceOrderNotEligible = errors.New("order is not eligible for invoicing")
	ErrInvoiceOrderTaken       = errors.New("order already has an invoice request")
	ErrInvoiceCurrencyMixed    = errors.New("selected orders have mixed currencies")
	ErrInvoiceBankRequired     = errors.New("bank name and account are required for special invoices")
	ErrInvoiceAmountInvalid    = errors.New("invalid invoice amount")
)

// InvoiceProfile is a reusable invoice title (开票资料) owned by a user.
type InvoiceProfile struct {
	Id     int `json:"id"`
	UserId int `json:"user_id" gorm:"index"`

	TitleType string `json:"title_type" gorm:"type:varchar(16);not null;default:'company'"`
	Title     string `json:"title" gorm:"type:varchar(255);not null"`
	TaxNo     string `json:"tax_no" gorm:"type:varchar(64);default:''"`

	Address     string `json:"address" gorm:"type:varchar(255);default:''"`
	Phone       string `json:"phone" gorm:"type:varchar(64);default:''"`
	BankName    string `json:"bank_name" gorm:"type:varchar(255);default:''"`
	BankAccount string `json:"bank_account" gorm:"type:varchar(64);default:''"`

	IsDefault bool `json:"is_default"`

	CreatedAt int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

// InvoiceRequest is one invoice application. The title fields are a snapshot of
// the InvoiceProfile at submission time: editing the profile later must not
// rewrite the details of invoices already issued.
type InvoiceRequest struct {
	Id     int `json:"id"`
	UserId int `json:"user_id" gorm:"index;index:idx_invoice_user_status,priority:1"`

	InvoiceType string `json:"invoice_type" gorm:"type:varchar(16);not null;default:'normal'"`
	Status      string `json:"status" gorm:"type:varchar(16);index;index:idx_invoice_user_status,priority:2"`

	// Snapshot of InvoiceProfile at submission time.
	ProfileId   int    `json:"profile_id" gorm:"index"`
	TitleType   string `json:"title_type" gorm:"type:varchar(16);not null;default:'company'"`
	Title       string `json:"title" gorm:"type:varchar(255);not null"`
	TaxNo       string `json:"tax_no" gorm:"type:varchar(64);default:''"`
	Address     string `json:"address" gorm:"type:varchar(255);default:''"`
	Phone       string `json:"phone" gorm:"type:varchar(64);default:''"`
	BankName    string `json:"bank_name" gorm:"type:varchar(255);default:''"`
	BankAccount string `json:"bank_account" gorm:"type:varchar(64);default:''"`

	// AmountTotal is stored in minor units (分) because an invoice is a legal
	// document: float accumulation error is not acceptable here, even though
	// other money columns in this codebase use float64.
	AmountTotal int64  `json:"amount_total" gorm:"type:bigint;not null;default:0"`
	Currency    string `json:"currency" gorm:"type:varchar(8);not null;default:'CNY'"`

	RecipientEmail string `json:"recipient_email" gorm:"type:varchar(255);not null"`
	Remark         string `json:"remark" gorm:"type:varchar(500);default:''"`

	// Filled by the admin when issuing.
	InvoiceNo    string `json:"invoice_no" gorm:"type:varchar(64);index;default:''"`
	PdfUrl       string `json:"pdf_url" gorm:"type:text"`
	RejectReason string `json:"reject_reason" gorm:"type:varchar(500);default:''"`
	OperatorId   int    `json:"operator_id" gorm:"default:0"`

	// TradeNoSnapshot keeps the invoiced order numbers readable after the
	// InvoiceItem rows are released on cancel/reject.
	TradeNoSnapshot string `json:"trade_no_snapshot" gorm:"type:text"`

	CreateTime int64 `json:"create_time" gorm:"bigint;index"`
	IssueTime  int64 `json:"issue_time" gorm:"bigint;default:0"`

	// Email delivery bookkeeping, surfaced in the admin list so a failed send
	// can be retried instead of silently stranding the customer.
	EmailSentAt int64  `json:"email_sent_at" gorm:"bigint;default:0"`
	EmailError  string `json:"email_error" gorm:"type:varchar(500);default:''"`
}

// InvoiceItem links an invoice request to one paid order. The unique index on
// (source_type, source_id) is what prevents the same order from being invoiced
// twice; application-level checks alone would race.
type InvoiceItem struct {
	Id        int `json:"id"`
	RequestId int `json:"request_id" gorm:"index"`

	SourceType string `json:"source_type" gorm:"type:varchar(16);not null;uniqueIndex:idx_invoice_item_source,priority:1"`
	SourceId   int    `json:"source_id" gorm:"not null;uniqueIndex:idx_invoice_item_source,priority:2"`

	TradeNo  string `json:"trade_no" gorm:"type:varchar(255);index"`
	Amount   int64  `json:"amount" gorm:"type:bigint;not null;default:0"`
	Currency string `json:"currency" gorm:"type:varchar(8);not null;default:'CNY'"`
	// PayTime snapshots the order's completion time at submission. The invoice
	// detail must keep showing when each order was paid even if the order is
	// later purged or its row changes.
	PayTime int64 `json:"pay_time" gorm:"bigint;default:0"`
}

// InvoiceableOrder is one row of the "待开票" list. It is projected from either
// TopUp or SubscriptionOrder, so it is not a table.
type InvoiceableOrder struct {
	SourceType string `json:"source_type"`
	SourceId   int    `json:"source_id"`
	TradeNo    string `json:"trade_no"`
	Amount     int64  `json:"amount"`
	Currency   string `json:"currency"`
	PayTime    int64  `json:"pay_time"`
}

// InvoiceAmountSummary totals one currency's invoicing position for a user. The
// figures are aggregated server-side because the application list is paginated:
// summing the visible page would understate every total.
type InvoiceAmountSummary struct {
	Currency string `json:"currency"`
	// PendingMinor covers pending applications: money the user has claimed but
	// finance has not issued yet.
	PendingMinor int64 `json:"pending_minor"`
	// IssuedMinor covers issued applications only. Rejected and cancelled ones
	// release their orders, so they belong to InvoiceableMinor instead.
	IssuedMinor int64 `json:"issued_minor"`
	// InvoiceableMinor is the paid amount still free to be claimed.
	InvoiceableMinor int64 `json:"invoiceable_minor"`
}
