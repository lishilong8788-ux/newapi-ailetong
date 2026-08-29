package model

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// InvoiceOrderRef identifies one order the client wants invoiced.
type InvoiceOrderRef struct {
	SourceType string `json:"source_type"`
	SourceId   int    `json:"source_id"`
}

// CreateInvoiceRequestParams is the validated input for a new application.
type CreateInvoiceRequestParams struct {
	UserId         int
	ProfileId      int
	InvoiceType    string
	RecipientEmail string
	Remark         string
	Orders         []InvoiceOrderRef
}

// CreateInvoiceRequest validates and records one invoice application.
//
// Eligibility is re-checked inside the transaction rather than trusted from the
// client, and the unique index on (source_type, source_id) is the final
// authority: two concurrent submissions naming the same order cannot both win.
func CreateInvoiceRequest(params CreateInvoiceRequestParams) (*InvoiceRequest, error) {
	if len(params.Orders) == 0 {
		return nil, ErrInvoiceNoOrders
	}

	invoiceType := params.InvoiceType
	if invoiceType != InvoiceTypeSpecial {
		invoiceType = InvoiceTypeNormal
	}

	profile, err := GetInvoiceProfileById(params.ProfileId, params.UserId)
	if err != nil {
		return nil, err
	}
	// A special (专用) invoice is only valid with payee bank details.
	if invoiceType == InvoiceTypeSpecial && (profile.BankName == "" || profile.BankAccount == "") {
		return nil, ErrInvoiceBankRequired
	}

	// Deduplicate the client's selection so a repeated order does not inflate
	// the total before the unique index rejects it.
	seen := make(map[string]struct{}, len(params.Orders))
	refs := make([]InvoiceOrderRef, 0, len(params.Orders))
	for _, ref := range params.Orders {
		key := ref.SourceType + ":" + strconv.Itoa(ref.SourceId)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		refs = append(refs, ref)
	}

	items := make([]InvoiceItem, 0, len(refs))
	tradeNos := make([]string, 0, len(refs))
	var total int64
	currency := ""

	for _, ref := range refs {
		order, lookupErr := LookupInvoiceableOrder(params.UserId, ref.SourceType, ref.SourceId)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if currency == "" {
			currency = order.Currency
		} else if currency != order.Currency {
			// One invoice states one currency; mixing CNY and USD orders would
			// make the stated total meaningless.
			return nil, ErrInvoiceCurrencyMixed
		}
		total += order.Amount
		tradeNos = append(tradeNos, order.TradeNo)
		items = append(items, InvoiceItem{
			SourceType: order.SourceType,
			SourceId:   order.SourceId,
			TradeNo:    order.TradeNo,
			Amount:     order.Amount,
			Currency:   order.Currency,
			PayTime:    order.PayTime,
		})
	}

	if total <= 0 {
		return nil, ErrInvoiceAmountInvalid
	}

	request := &InvoiceRequest{
		UserId:          params.UserId,
		InvoiceType:     invoiceType,
		Status:          InvoiceStatusPending,
		ProfileId:       profile.Id,
		TitleType:       profile.TitleType,
		Title:           profile.Title,
		TaxNo:           profile.TaxNo,
		Address:         profile.Address,
		Phone:           profile.Phone,
		BankName:        profile.BankName,
		BankAccount:     profile.BankAccount,
		AmountTotal:     total,
		Currency:        currency,
		RecipientEmail:  strings.TrimSpace(params.RecipientEmail),
		Remark:          strings.TrimSpace(params.Remark),
		TradeNoSnapshot: strings.Join(tradeNos, ","),
		CreateTime:      common.GetTimestamp(),
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(request).Error; err != nil {
			return err
		}
		for i := range items {
			items[i].RequestId = request.Id
		}
		// Any failure here is a unique-index violation on (source_type,
		// source_id): eligibility was just verified, so a concurrent
		// application claiming the same order is the only remaining cause.
		// Checking the driver error text would not port across SQLite, MySQL
		// and PostgreSQL.
		if err := tx.Create(&items).Error; err != nil {
			return ErrInvoiceOrderTaken
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return request, nil
}

// searchInvoiceCountHardLimit bounds the COUNT of a keyword search so a huge
// table cannot be turned into an unbounded scan.
const searchInvoiceCountHardLimit = 10000

func GetUserInvoiceRequests(userId int, status string, keyword string, pageInfo *common.PageInfo) (requests []*InvoiceRequest, total int64, err error) {
	query := DB.Model(&InvoiceRequest{}).Where("user_id = ?", userId)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if keyword != "" {
		pattern, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			return nil, 0, perr
		}
		query = query.Where("(invoice_no LIKE ? ESCAPE '!' OR trade_no_snapshot LIKE ? ESCAPE '!')", pattern, pattern)
	}

	if err = query.Limit(searchInvoiceCountHardLimit).Count(&total).Error; err != nil {
		common.SysError("failed to count invoice requests: " + err.Error())
		return nil, 0, errors.New("获取发票申请失败")
	}

	err = query.Order("id desc").
		Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).
		Find(&requests).Error
	if err != nil {
		common.SysError("failed to list invoice requests: " + err.Error())
		return nil, 0, errors.New("获取发票申请失败")
	}
	return requests, total, nil
}

// InvoiceRequestAdminView is one row of the admin console list: the application
// plus the applicant's username, so the operator sees who applied without a
// per-row user lookup.
type InvoiceRequestAdminView struct {
	InvoiceRequest
	Username string `json:"username"`
}

// GetAllInvoiceRequests lists every user's applications for the admin console.
// The keyword additionally matches the invoice title, which is how finance staff
// usually look up a company's application.
func GetAllInvoiceRequests(status string, keyword string, pageInfo *common.PageInfo) (requests []InvoiceRequestAdminView, total int64, err error) {
	query := DB.Model(&InvoiceRequest{}).
		Select("invoice_requests.*, COALESCE(users.username, '') AS username").
		Joins("LEFT JOIN users ON users.id = invoice_requests.user_id")
	if status != "" {
		query = query.Where("invoice_requests.status = ?", status)
	}
	if keyword != "" {
		pattern, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			return nil, 0, perr
		}
		query = query.Where("(invoice_requests.invoice_no LIKE ? ESCAPE '!' OR invoice_requests.trade_no_snapshot LIKE ? ESCAPE '!' OR invoice_requests.title LIKE ? ESCAPE '!')",
			pattern, pattern, pattern)
	}

	if err = query.Limit(searchInvoiceCountHardLimit).Count(&total).Error; err != nil {
		common.SysError("failed to count invoice requests: " + err.Error())
		return nil, 0, errors.New("获取发票申请失败")
	}

	err = query.Order("invoice_requests.id desc").
		Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).
		Find(&requests).Error
	if err != nil {
		common.SysError("failed to list invoice requests: " + err.Error())
		return nil, 0, errors.New("获取发票申请失败")
	}
	return requests, total, nil
}

// GetInvoiceRequestById reads one application. A userId of 0 means an admin read
// and skips the ownership check; any positive userId must own the row, because
// the record carries the company tax number and bank account.
func GetInvoiceRequestById(id int, userId int) (*InvoiceRequest, error) {
	query := DB.Where("id = ?", id)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	var request InvoiceRequest
	if err := query.First(&request).Error; err != nil {
		return nil, ErrInvoiceRequestNotFound
	}
	return &request, nil
}

func GetInvoiceRequestItems(requestId int) ([]*InvoiceItem, error) {
	var items []*InvoiceItem
	err := DB.Where("request_id = ?", requestId).Order("id asc").Find(&items).Error
	return items, err
}

// lockInvoiceRequestForTransition reads one application under a row lock and
// verifies it is in a state the caller may leave. Every status change goes
// through this so two concurrent admins cannot both issue or both reject the
// same application.
func lockInvoiceRequestForTransition(tx *gorm.DB, id int, userId int, allowed ...string) (*InvoiceRequest, error) {
	query := lockForUpdate(tx).Where("id = ?", id)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	var request InvoiceRequest
	if err := query.First(&request).Error; err != nil {
		return nil, ErrInvoiceRequestNotFound
	}
	for _, status := range allowed {
		if request.Status == status {
			return &request, nil
		}
	}
	return nil, ErrInvoiceStatusInvalid
}

// CancelInvoiceRequest withdraws a pending application. Deleting the items is
// what returns the orders to the invoiceable pool.
func CancelInvoiceRequest(id int, userId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		request, err := lockInvoiceRequestForTransition(tx, id, userId, InvoiceStatusPending)
		if err != nil {
			return err
		}
		if err := tx.Model(&InvoiceRequest{}).Where("id = ?", request.Id).
			Update("status", InvoiceStatusCancelled).Error; err != nil {
			return err
		}
		return tx.Where("request_id = ?", request.Id).Delete(&InvoiceItem{}).Error
	})
}

// IssueInvoiceRequest records the invoice number and PDF link an admin filled in.
// The items stay in place: the orders are now invoiced and must never return to
// the invoiceable pool.
func IssueInvoiceRequest(id int, operatorId int, invoiceNo string, pdfUrl string, issueTime int64) error {
	if issueTime <= 0 {
		issueTime = common.GetTimestamp()
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		request, err := lockInvoiceRequestForTransition(tx, id, 0, InvoiceStatusPending)
		if err != nil {
			return err
		}
		return tx.Model(&InvoiceRequest{}).Where("id = ?", request.Id).
			Updates(map[string]interface{}{
				"status":      InvoiceStatusIssued,
				"invoice_no":  strings.TrimSpace(invoiceNo),
				"pdf_url":     strings.TrimSpace(pdfUrl),
				"issue_time":  issueTime,
				"operator_id": operatorId,
			}).Error
	})
}

// RejectInvoiceRequest declines an application and releases its orders so the
// user can correct the details and apply again.
func RejectInvoiceRequest(id int, operatorId int, reason string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		request, err := lockInvoiceRequestForTransition(tx, id, 0, InvoiceStatusPending)
		if err != nil {
			return err
		}
		if err := tx.Model(&InvoiceRequest{}).Where("id = ?", request.Id).
			Updates(map[string]interface{}{
				"status":        InvoiceStatusRejected,
				"reject_reason": strings.TrimSpace(reason),
				"operator_id":   operatorId,
			}).Error; err != nil {
			return err
		}
		return tx.Where("request_id = ?", request.Id).Delete(&InvoiceItem{}).Error
	})
}

// UpdateInvoiceEmailResult records the outcome of the notification email so a
// failed delivery is visible in the admin list and can be retried.
func UpdateInvoiceEmailResult(id int, sentAt int64, errMsg string) error {
	// email_error is varchar(500); an upstream SMTP error can be far longer.
	// Truncating by rune keeps multi-byte messages from being cut mid-character.
	if runes := []rune(errMsg); len(runes) > 500 {
		errMsg = string(runes[:500])
	}
	return DB.Model(&InvoiceRequest{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"email_sent_at": sentAt,
			"email_error":   errMsg,
		}).Error
}
