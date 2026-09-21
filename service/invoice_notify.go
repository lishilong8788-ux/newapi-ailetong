package service

import (
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/bytedance/gopkg/util/gopool"
)

// formatInvoiceAmount renders a minor-unit (分/cent) total for display.
//
// The arithmetic is deliberately integer-only: this figure is quoted on a legal
// document, so it must not pick up float rounding drift on its way to the
// customer.
func formatInvoiceAmount(minorUnits int64, currency string) string {
	sign := ""
	if minorUnits < 0 {
		sign = "-"
	}
	major := minorUnits / 100
	minor := minorUnits % 100
	if major < 0 {
		major = -major
	}
	if minor < 0 {
		minor = -minor
	}

	var symbol string
	switch currency {
	// The currency column defaults to CNY and is NOT NULL, so an empty value
	// only appears on an unsaved struct; treat it as the default.
	case "CNY", "":
		symbol = "¥"
	case "USD":
		symbol = "$"
	default:
		symbol = currency + " "
	}
	return fmt.Sprintf("%s%s%d.%02d", sign, symbol, major, minor)
}

// invoiceTypeLabel is the Chinese name of an invoice kind, as printed on the
// document itself.
func invoiceTypeLabel(invoiceType string) string {
	if invoiceType == model.InvoiceTypeSpecial {
		return "增值税专用发票"
	}
	return "增值税普通发票"
}

// invoiceReadyToNotify loads a request that is due a customer email and returns
// it together with the address to send to, or nil when the mail must be skipped.
//
// The address is re-validated here even though the submit endpoint checks it:
// it is interpolated into the SMTP `To:` header, so a stray CR/LF would let a
// stored value forge additional headers.
func invoiceReadyToNotify(requestId int, wantStatus string) (*model.InvoiceRequest, string) {
	request, err := model.GetInvoiceRequestById(requestId, 0)
	if err != nil {
		common.SysError(fmt.Sprintf("failed to load invoice request %d for %s notify: %s", requestId, wantStatus, err.Error()))
		return nil, ""
	}
	if request.Status != wantStatus {
		common.SysLog(fmt.Sprintf("skip %s invoice notify for request %d: status is %s", wantStatus, requestId, request.Status))
		return nil, ""
	}
	recipient := strings.TrimSpace(request.RecipientEmail)
	if recipient == "" {
		common.SysLog(fmt.Sprintf("skip %s invoice notify for request %d: no recipient email", wantStatus, requestId))
		return nil, ""
	}
	if err := common.Validate.Var(recipient, "email"); err != nil {
		// Recorded rather than only logged, so the admin sees why the customer
		// never received the mail and can fix the address.
		recordInvoiceEmailResult(requestId, fmt.Errorf("收票邮箱格式无效: %s", recipient))
		return nil, ""
	}
	return request, recipient
}

// recordInvoiceEmailResult persists the delivery outcome so the admin list can
// show a failed send and offer a manual retry.
func recordInvoiceEmailResult(requestId int, sendErr error) {
	if sendErr == nil {
		if err := model.UpdateInvoiceEmailResult(requestId, common.GetTimestamp(), ""); err != nil {
			common.SysError(fmt.Sprintf("failed to record invoice email success for request %d: %s", requestId, err.Error()))
		}
		return
	}

	common.SysError(fmt.Sprintf("failed to send invoice email for request %d: %s", requestId, sendErr.Error()))
	// UpdateInvoiceEmailResult trims the message to the column width.
	if err := model.UpdateInvoiceEmailResult(requestId, 0, sendErr.Error()); err != nil {
		common.SysError(fmt.Sprintf("failed to record invoice email failure for request %d: %s", requestId, err.Error()))
	}
}

// SendInvoiceIssuedNotify mails the finished invoice to the customer.
//
// The mail goes straight to common.SendEmail instead of through NotifyUser: an
// invoice is a transactional message, so it must not be re-routed to a
// webhook/Bark channel that cannot carry the PDF link, and it must not be
// dropped by the hourly notification limit. The recipient is the address given
// on the application, which for a company is usually the finance mailbox rather
// than the account's login email.
func SendInvoiceIssuedNotify(requestId int) {
	gopool.Go(func() {
		request, recipient := invoiceReadyToNotify(requestId, model.InvoiceStatusIssued)
		if request == nil {
			return
		}

		issueTime := "-"
		if request.IssueTime > 0 {
			issueTime = time.Unix(request.IssueTime, 0).Format("2006-01-02 15:04:05")
		}
		tradeNos := strings.ReplaceAll(request.TradeNoSnapshot, ",", "、")
		if tradeNos == "" {
			tradeNos = "-"
		}

		// Invoice number, title, order numbers and PDF URL all end up inside an
		// HTML document, so they are escaped rather than interpolated raw.
		var body strings.Builder
		body.WriteString("<p>您好，您申请的发票已开出，详情如下：</p>")
		body.WriteString(fmt.Sprintf("<p>发票号码：<strong>%s</strong></p>", html.EscapeString(request.InvoiceNo)))
		body.WriteString(fmt.Sprintf("<p>发票类型：%s</p>", invoiceTypeLabel(request.InvoiceType)))
		body.WriteString(fmt.Sprintf("<p>开票金额：<strong>%s</strong></p>", formatInvoiceAmount(request.AmountTotal, request.Currency)))
		body.WriteString(fmt.Sprintf("<p>发票抬头：%s</p>", html.EscapeString(request.Title)))
		body.WriteString(fmt.Sprintf("<p>关联订单：%s</p>", html.EscapeString(tradeNos)))
		body.WriteString(fmt.Sprintf("<p>开票时间：%s</p>", issueTime))
		// Loaded before the mail is built so an unreadable file fails the send and
		// stays retryable, instead of mailing the customer a message that claims to
		// carry the invoice but does not.
		attachments, err := InvoiceMailAttachments(request.Id)
		if err != nil {
			recordInvoiceEmailResult(requestId, err)
			return
		}
		if len(attachments) > 0 {
			names := make([]string, 0, len(attachments))
			for _, attachment := range attachments {
				names = append(names, html.EscapeString(attachment.FileName))
			}
			body.WriteString(fmt.Sprintf("<p>发票文件已作为附件随本邮件发送：%s</p>", strings.Join(names, "、")))
		}
		if pdfUrl := strings.TrimSpace(request.PdfUrl); pdfUrl != "" {
			escapedUrl := html.EscapeString(pdfUrl)
			// The link is written twice on purpose: some mail clients strip the
			// anchor tag, and the plain-text copy is then the only way to reach
			// the PDF.
			body.WriteString(fmt.Sprintf("<p>发票下载：<a href='%s'>点击下载发票 PDF</a></p>", escapedUrl))
			body.WriteString(fmt.Sprintf("<p>如果链接无法点击，请复制下面的地址到浏览器打开：<br>%s</p>", escapedUrl))
		}
		body.WriteString("<p>如对发票内容有疑问，请联系客服处理。</p>")

		subject := fmt.Sprintf("%s 发票已开出", common.SystemName)
		recordInvoiceEmailResult(requestId, common.SendEmailWithAttachments(subject, recipient, body.String(), attachments))
	})
}

// SendInvoiceRejectedNotify tells the customer why an application was declined.
// Like the issued mail this bypasses NotifyUser, for the same reasons.
func SendInvoiceRejectedNotify(requestId int) {
	gopool.Go(func() {
		request, recipient := invoiceReadyToNotify(requestId, model.InvoiceStatusRejected)
		if request == nil {
			return
		}

		reason := strings.TrimSpace(request.RejectReason)
		if reason == "" {
			reason = "未填写具体原因，请联系客服了解详情"
		}

		var body strings.Builder
		body.WriteString("<p>您好，您提交的开票申请未能通过审核。</p>")
		body.WriteString(fmt.Sprintf("<p>驳回原因：<strong>%s</strong></p>", html.EscapeString(reason)))
		body.WriteString(fmt.Sprintf("<p>申请金额：%s</p>", formatInvoiceAmount(request.AmountTotal, request.Currency)))
		body.WriteString(fmt.Sprintf("<p>发票抬头：%s</p>", html.EscapeString(request.Title)))
		body.WriteString(fmt.Sprintf("<p>发票类型：%s</p>", invoiceTypeLabel(request.InvoiceType)))
		body.WriteString("<p>关联订单已退回待开票列表，修改开票信息后可重新申请。</p>")

		subject := fmt.Sprintf("%s 开票申请被驳回", common.SystemName)
		recordInvoiceEmailResult(requestId, common.SendEmail(subject, recipient, body.String()))
	})
}

// NotifyAdminNewInvoiceRequest pings the admin that an application is waiting.
//
// This one does go through NotifyRootUser: it is an internal heads-up, so the
// admin's own channel choice and the notification limit are both acceptable.
func NotifyAdminNewInvoiceRequest(requestId int) {
	gopool.Go(func() {
		request, err := model.GetInvoiceRequestById(requestId, 0)
		if err != nil {
			common.SysError(fmt.Sprintf("failed to load invoice request %d for admin notify: %s", requestId, err.Error()))
			return
		}

		tradeNos := strings.ReplaceAll(request.TradeNoSnapshot, ",", "、")
		if tradeNos == "" {
			tradeNos = "-"
		}

		content := fmt.Sprintf("<p>有新的开票申请待处理。</p>"+
			"<p>申请编号：%d</p>"+
			"<p>用户 ID：%d</p>"+
			"<p>发票类型：%s</p>"+
			"<p>申请金额：%s</p>"+
			"<p>发票抬头：%s</p>"+
			"<p>关联订单：%s</p>"+
			"<p>收票邮箱：%s</p>"+
			"<p>请到后台发票管理页面处理。</p>",
			request.Id,
			request.UserId,
			invoiceTypeLabel(request.InvoiceType),
			formatInvoiceAmount(request.AmountTotal, request.Currency),
			html.EscapeString(request.Title),
			html.EscapeString(tradeNos),
			html.EscapeString(request.RecipientEmail))

		NotifyRootUser(dto.NotifyTypeInvoiceRequest, fmt.Sprintf("%s 新开票申请", common.SystemName), content)
	})
}
