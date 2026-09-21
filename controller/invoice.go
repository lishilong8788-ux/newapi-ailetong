package controller

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// respondInvoiceError turns the model's sentinel errors into wording a customer
// can act on. Anything unrecognised is reported generically rather than leaking
// a driver or constraint message to the browser.
func respondInvoiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrInvoiceProfileNotFound):
		common.ApiErrorMsg(c, "开票资料不存在")
	case errors.Is(err, model.ErrInvoiceRequestNotFound):
		common.ApiErrorMsg(c, "发票申请不存在")
	case errors.Is(err, model.ErrInvoiceStatusInvalid):
		common.ApiErrorMsg(c, "当前状态不允许该操作，请刷新后重试")
	case errors.Is(err, model.ErrInvoiceNoOrders):
		common.ApiErrorMsg(c, "请至少选择一笔订单")
	case errors.Is(err, model.ErrInvoiceOrderNotEligible):
		common.ApiErrorMsg(c, "所选订单不可开票，请刷新可开票订单列表")
	case errors.Is(err, model.ErrInvoiceOrderTaken):
		common.ApiErrorMsg(c, "所选订单已提交过开票申请")
	case errors.Is(err, model.ErrInvoiceCurrencyMixed):
		common.ApiErrorMsg(c, "同一张发票不能混合不同币种的订单，请分开申请")
	case errors.Is(err, model.ErrInvoiceBankRequired):
		common.ApiErrorMsg(c, "开具专用发票需要填写开户行和银行账号")
	case errors.Is(err, model.ErrInvoiceAmountInvalid):
		common.ApiErrorMsg(c, "开票金额无效")
	case errors.Is(err, model.ErrInvoiceAttachmentLimit):
		common.ApiErrorMsg(c, fmt.Sprintf("每张发票最多上传 %d 个附件", model.MaxInvoiceAttachmentsPerItem))
	case errors.Is(err, model.ErrInvoiceAttachmentQuota):
		common.ApiErrorMsg(c, fmt.Sprintf("附件总大小不能超过 %d MB", model.MaxInvoiceAttachmentTotalBytes>>20))
	case errors.Is(err, model.ErrInvoiceAttachmentNotFnd):
		common.ApiErrorMsg(c, "发票附件不存在")
	case errors.Is(err, model.ErrInvoiceDocumentMissing):
		common.ApiErrorMsg(c, "请上传发票附件，或填写发票 PDF 链接")
	default:
		common.ApiError(c, err)
	}
}

// validateInvoicePdfUrl rejects a link the customer would not be able to open.
//
// The plain `http(s)://` prefix check this replaces let `https://11111` through:
// that parses as a host literally named `11111`, which browsers then resolve as
// an integer-form IPv4 address (0.0.43.103) and security interstitials block. The
// address is mailed to a customer and used as a redirect target, so it has to be
// a real public hostname.
func validateInvoicePdfUrl(raw string) error {
	if len(raw) > 1024 {
		return errors.New("发票 PDF 链接长度不能超过 1024 个字符")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return errors.New("发票 PDF 链接格式无效")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("发票 PDF 链接必须以 http:// 或 https:// 开头")
	}
	host := parsed.Hostname()
	if host == "" {
		return errors.New("发票 PDF 链接缺少域名")
	}
	if net.ParseIP(host) != nil {
		return errors.New("发票 PDF 链接不能使用 IP 地址，请填写可公网访问的域名")
	}
	labels := strings.Split(host, ".")
	topLevel := labels[len(labels)-1]
	// A real public suffix always starts with a letter — including punycode ones
	// such as xn--fiqs8s. This is what catches `11111`, `localhost` and the hex or
	// decimal host forms that browsers still treat as addresses.
	if len(labels) < 2 || len(topLevel) < 2 || !isAsciiLetter(rune(topLevel[0])) {
		return errors.New("发票 PDF 链接不是有效的域名，请检查是否填错")
	}
	return nil
}

func isAsciiLetter(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

// ---- User APIs: invoice titles ----

// InvoiceProfileRequest is the client-writable part of an invoice title. The
// model struct is deliberately not bound directly, so a client cannot set Id or
// UserId and reach another user's row.
type InvoiceProfileRequest struct {
	TitleType   string `json:"title_type"`
	Title       string `json:"title"`
	TaxNo       string `json:"tax_no"`
	Address     string `json:"address"`
	Phone       string `json:"phone"`
	BankName    string `json:"bank_name"`
	BankAccount string `json:"bank_account"`
	IsDefault   bool   `json:"is_default"`
}

// toInvoiceProfile validates the payload against the column widths and the
// business rule that a company title needs a tax registration number.
func (req *InvoiceProfileRequest) toInvoiceProfile(userId int) (*model.InvoiceProfile, error) {
	profile := &model.InvoiceProfile{
		UserId:      userId,
		TitleType:   req.TitleType,
		Title:       strings.TrimSpace(req.Title),
		TaxNo:       strings.TrimSpace(req.TaxNo),
		Address:     strings.TrimSpace(req.Address),
		Phone:       strings.TrimSpace(req.Phone),
		BankName:    strings.TrimSpace(req.BankName),
		BankAccount: strings.TrimSpace(req.BankAccount),
		IsDefault:   req.IsDefault,
	}
	if profile.Title == "" {
		return nil, errors.New("发票抬头不能为空")
	}
	if profile.TitleType != model.InvoiceTitleTypePersonal && profile.TaxNo == "" {
		return nil, errors.New("企业抬头必须填写纳税人识别号")
	}
	for _, field := range []struct {
		name  string
		value string
		max   int
	}{
		{"发票抬头", profile.Title, 255},
		{"纳税人识别号", profile.TaxNo, 64},
		{"注册地址", profile.Address, 255},
		{"电话", profile.Phone, 64},
		{"开户行", profile.BankName, 255},
		{"银行账号", profile.BankAccount, 64},
	} {
		if len([]rune(field.value)) > field.max {
			return nil, fmt.Errorf("%s长度不能超过 %d 个字符", field.name, field.max)
		}
	}
	return profile, nil
}

func GetInvoiceProfiles(c *gin.Context) {
	profiles, err := model.GetUserInvoiceProfiles(c.GetInt("id"))
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	common.ApiSuccess(c, profiles)
}

func CreateInvoiceProfile(c *gin.Context) {
	var req InvoiceProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	profile, err := req.toInvoiceProfile(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := profile.Insert(); err != nil {
		respondInvoiceError(c, err)
		return
	}
	common.ApiSuccess(c, profile)
}

func UpdateInvoiceProfile(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req InvoiceProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	profile, err := req.toInvoiceProfile(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	profile.Id = id
	if err := profile.Update(); err != nil {
		respondInvoiceError(c, err)
		return
	}
	common.ApiSuccess(c, profile)
}

func DeleteInvoiceProfile(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	if err := model.DeleteInvoiceProfile(id, c.GetInt("id")); err != nil {
		respondInvoiceError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- User APIs: applications ----

func GetInvoiceableOrders(c *gin.Context) {
	orders, err := model.GetInvoiceableOrders(c.GetInt("id"))
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	common.ApiSuccess(c, orders)
}

// GetInvoiceAmountSummary reports the pending / issued / invoiceable totals shown
// above the invoice list. It is a separate endpoint because the application list
// is paginated and the page-local sum would be wrong.
func GetInvoiceAmountSummary(c *gin.Context) {
	summaries, err := model.GetUserInvoiceAmountSummary(c.GetInt("id"))
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	common.ApiSuccess(c, summaries)
}

type CreateInvoiceRequestPayload struct {
	ProfileId      int                     `json:"profile_id"`
	InvoiceType    string                  `json:"invoice_type"`
	RecipientEmail string                  `json:"recipient_email"`
	Remark         string                  `json:"remark"`
	Orders         []model.InvoiceOrderRef `json:"orders"`
}

func CreateInvoiceRequestHandler(c *gin.Context) {
	var payload CreateInvoiceRequestPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if payload.ProfileId <= 0 {
		common.ApiErrorMsg(c, "请选择开票资料")
		return
	}
	email := strings.TrimSpace(payload.RecipientEmail)
	if email == "" {
		common.ApiErrorMsg(c, "请填写收票邮箱")
		return
	}
	// The issued PDF is delivered by email, so an unusable address means the
	// customer never receives the invoice.
	if _, err := mail.ParseAddress(email); err != nil {
		common.ApiErrorMsg(c, "收票邮箱格式不正确")
		return
	}
	if len(email) > 255 {
		common.ApiErrorMsg(c, "收票邮箱长度不能超过 255 个字符")
		return
	}
	if len([]rune(payload.Remark)) > 500 {
		common.ApiErrorMsg(c, "备注长度不能超过 500 个字符")
		return
	}

	request, err := model.CreateInvoiceRequest(model.CreateInvoiceRequestParams{
		UserId:         c.GetInt("id"),
		ProfileId:      payload.ProfileId,
		InvoiceType:    payload.InvoiceType,
		RecipientEmail: email,
		Remark:         payload.Remark,
		Orders:         payload.Orders,
	})
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	service.NotifyAdminNewInvoiceRequest(request.Id)
	common.ApiSuccess(c, request)
}

func GetSelfInvoiceRequests(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	requests, total, err := model.GetUserInvoiceRequests(
		c.GetInt("id"), c.Query("status"), c.Query("keyword"), pageInfo)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(requests)
	common.ApiSuccess(c, pageInfo)
}

func GetSelfInvoiceRequestDetail(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	request, err := model.GetInvoiceRequestById(id, c.GetInt("id"))
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	items, err := model.GetInvoiceRequestItems(request.Id)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	attachments, err := model.GetInvoiceAttachments(request.Id)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"request": request, "items": items, "attachments": attachments})
}

func CancelSelfInvoiceRequest(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	releasedPaths, err := model.CancelInvoiceRequest(id, c.GetInt("id"))
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	service.RemoveInvoiceAttachmentFiles(releasedPaths)
	common.ApiSuccess(c, nil)
}

// serveInvoiceAttachment streams one stored file.
//
// The original file name is restored in Content-Disposition: on disk the file is
// named by UUID, and a customer saving `a3f2...pdf` has no way to tell which
// invoice it is.
func serveInvoiceAttachment(c *gin.Context, attachment *model.InvoiceAttachment) {
	absolutePath, err := service.ResolveInvoiceAttachmentPath(attachment.StoredPath)
	if err != nil {
		common.SysError("failed to resolve invoice attachment path: " + err.Error())
		common.ApiErrorMsg(c, "发票附件不可读，请联系管理员")
		return
	}
	if _, err := os.Stat(absolutePath); err != nil {
		common.SysError("invoice attachment file missing: " + err.Error())
		common.ApiErrorMsg(c, "发票附件文件已丢失，请联系管理员重新上传")
		return
	}
	if attachment.MimeType != "" {
		// Set before ServeFile, which only sniffs a type when none is present.
		c.Header("Content-Type", attachment.MimeType)
	}
	c.FileAttachment(absolutePath, attachment.FileName)
}

// serveInvoiceDocument answers a "download this invoice" action.
//
// An uploaded file wins over the stored link: it is the exact document mailed to
// the customer, it is served from the platform's own domain, and it cannot rot
// the way a third-party URL can. The link stays as the fallback for invoices
// issued before attachments existed.
func serveInvoiceDocument(c *gin.Context, request *model.InvoiceRequest) {
	if request.Status != model.InvoiceStatusIssued {
		common.ApiErrorMsg(c, "发票尚未开具")
		return
	}
	attachments, err := model.GetInvoiceAttachments(request.Id)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	if len(attachments) > 0 {
		serveInvoiceAttachment(c, attachments[0])
		return
	}
	if strings.TrimSpace(request.PdfUrl) == "" {
		common.ApiErrorMsg(c, "该发票没有可下载的文件，请联系客服")
		return
	}
	c.Redirect(http.StatusFound, request.PdfUrl)
}

// DownloadInvoicePdf serves the invoice document to its owner. The ownership
// check is the whole point of routing the download through the server: the
// document carries the company name, tax number and bank account.
func DownloadInvoicePdf(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	request, err := model.GetInvoiceRequestById(id, c.GetInt("id"))
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	serveInvoiceDocument(c, request)
}

// DownloadSelfInvoiceAttachment serves one specific file of the caller's own
// invoice, for the case where finance uploaded several documents.
func DownloadSelfInvoiceAttachment(c *gin.Context) {
	requestId, _ := strconv.Atoi(c.Param("id"))
	attachmentId, _ := strconv.Atoi(c.Param("attachmentId"))
	if requestId <= 0 || attachmentId <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	attachment, err := model.GetInvoiceAttachmentById(attachmentId, requestId, c.GetInt("id"))
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	serveInvoiceAttachment(c, attachment)
}

// ---- Admin APIs ----

func AdminGetInvoiceRequests(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	requests, total, err := model.GetAllInvoiceRequests(
		c.Query("status"), c.Query("keyword"), pageInfo)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(requests)
	common.ApiSuccess(c, pageInfo)
}

func AdminGetInvoiceRequestDetail(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	request, err := model.GetInvoiceRequestById(id, 0)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	items, err := model.GetInvoiceRequestItems(request.Id)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	attachments, err := model.GetInvoiceAttachments(request.Id)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"request": request, "items": items, "attachments": attachments})
}

type AdminIssueInvoiceRequest struct {
	InvoiceNo   string `json:"invoice_no"`
	PdfUrl      string `json:"pdf_url"`
	IssueDate   string `json:"issue_date"`
	NotifyEmail bool   `json:"notify_email"`
}

func AdminIssueInvoice(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminIssueInvoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	invoiceNo := strings.TrimSpace(req.InvoiceNo)
	if invoiceNo == "" {
		common.ApiErrorMsg(c, "请填写发票号码")
		return
	}
	if len(invoiceNo) > 64 {
		common.ApiErrorMsg(c, "发票号码长度不能超过 64 个字符")
		return
	}
	// An invoice must ship with a document the customer can actually open: either
	// an uploaded file, which is mailed as a real attachment, or an external link.
	// The link is now the fallback, so it is only validated when one was given.
	pdfUrl := strings.TrimSpace(req.PdfUrl)
	attachmentCount, err := model.CountInvoiceAttachments(id)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	if pdfUrl == "" && attachmentCount == 0 {
		respondInvoiceError(c, model.ErrInvoiceDocumentMissing)
		return
	}
	if pdfUrl != "" {
		if err := validateInvoicePdfUrl(pdfUrl); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
	}

	var issueTime int64
	if date := strings.TrimSpace(req.IssueDate); date != "" {
		parsed, err := time.ParseInLocation("2006-01-02", date, time.Local)
		if err != nil {
			common.ApiErrorMsg(c, "开票日期格式应为 YYYY-MM-DD")
			return
		}
		issueTime = parsed.Unix()
	}

	if err := model.IssueInvoiceRequest(id, c.GetInt("id"), invoiceNo, pdfUrl, issueTime); err != nil {
		respondInvoiceError(c, err)
		return
	}
	if req.NotifyEmail {
		service.SendInvoiceIssuedNotify(id)
	}
	common.ApiSuccess(c, nil)
}

type AdminRejectInvoiceRequest struct {
	Reason string `json:"reason"`
}

func AdminRejectInvoice(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminRejectInvoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		common.ApiErrorMsg(c, "请填写驳回原因")
		return
	}
	if len([]rune(reason)) > 500 {
		common.ApiErrorMsg(c, "驳回原因长度不能超过 500 个字符")
		return
	}
	releasedPaths, err := model.RejectInvoiceRequest(id, c.GetInt("id"), reason)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	service.RemoveInvoiceAttachmentFiles(releasedPaths)
	service.SendInvoiceRejectedNotify(id)
	common.ApiSuccess(c, nil)
}

// AdminUploadInvoiceAttachment stores one invoice document against a request.
//
// Uploading is allowed while the application is pending (the normal flow: upload,
// then issue) and after it has been issued (re-upload of a corrected file), but
// not once it has been rejected or cancelled, where the document would describe
// an invoice that was never produced.
func AdminUploadInvoiceAttachment(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	request, err := model.GetInvoiceRequestById(id, 0)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	if request.Status != model.InvoiceStatusPending && request.Status != model.InvoiceStatusIssued {
		respondInvoiceError(c, model.ErrInvoiceStatusInvalid)
		return
	}

	header, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorMsg(c, "请选择要上传的文件")
		return
	}
	attachment, err := service.SaveInvoiceAttachment(request.Id, c.GetInt("id"), header)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	common.ApiSuccess(c, attachment)
}

// AdminDeleteInvoiceAttachment removes one uploaded document. The row is dropped
// first and the file after it, so a failed unlink leaves unused bytes on disk
// rather than a download the customer cannot open.
func AdminDeleteInvoiceAttachment(c *gin.Context) {
	requestId, _ := strconv.Atoi(c.Param("id"))
	attachmentId, _ := strconv.Atoi(c.Param("attachmentId"))
	if requestId <= 0 || attachmentId <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	storedPath, err := model.DeleteInvoiceAttachment(attachmentId, requestId)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	service.RemoveInvoiceAttachmentFiles([]string{storedPath})
	common.ApiSuccess(c, nil)
}

// AdminDownloadInvoiceAttachment lets finance verify exactly what was mailed.
func AdminDownloadInvoiceAttachment(c *gin.Context) {
	requestId, _ := strconv.Atoi(c.Param("id"))
	attachmentId, _ := strconv.Atoi(c.Param("attachmentId"))
	if requestId <= 0 || attachmentId <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	attachment, err := model.GetInvoiceAttachmentById(attachmentId, requestId, 0)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	serveInvoiceAttachment(c, attachment)
}

// AdminDownloadInvoiceDocument mirrors the customer's download button so an
// operator can confirm the link or file a customer is seeing.
func AdminDownloadInvoiceDocument(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	request, err := model.GetInvoiceRequestById(id, 0)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	serveInvoiceDocument(c, request)
}

func AdminResendInvoiceEmail(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	request, err := model.GetInvoiceRequestById(id, 0)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}
	if request.Status != model.InvoiceStatusIssued {
		common.ApiErrorMsg(c, "只有已开具的发票可以重新发送邮件")
		return
	}
	service.SendInvoiceIssuedNotify(request.Id)
	common.ApiSuccess(c, nil)
}

// invoiceExportPageSize bounds one CSV export. Manual invoicing is worked in
// batches far smaller than this; the cap only keeps the response from growing
// without limit.
const invoiceExportPageSize = 5000

// csvSafeCell neutralises spreadsheet formula injection. Excel and LibreOffice
// evaluate a cell that starts with =, +, - or @, and an invoice title is
// user-supplied text.
func csvSafeCell(value string) string {
	if value == "" {
		return value
	}
	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + value
	}
	return value
}

// AdminExportInvoiceRequests exports the worklist as CSV for the finance team's
// invoicing software. Defaults to the pending queue, which is what an operator
// wants to hand over to the tax system.
func AdminExportInvoiceRequests(c *gin.Context) {
	status := c.Query("status")
	if status == "" {
		status = model.InvoiceStatusPending
	}
	pageInfo := &common.PageInfo{Page: 1, PageSize: invoiceExportPageSize}
	requests, _, err := model.GetAllInvoiceRequests(status, c.Query("keyword"), pageInfo)
	if err != nil {
		respondInvoiceError(c, err)
		return
	}

	filename := fmt.Sprintf("invoice-requests-%s-%s.csv", status, time.Now().Format("20060102-150405"))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename="+filename)
	// Excel assumes the system codepage without a BOM, which renders Chinese as
	// mojibake.
	if _, err := c.Writer.WriteString("\xEF\xBB\xBF"); err != nil {
		common.SysError("failed to write invoice csv bom: " + err.Error())
		return
	}

	writer := csv.NewWriter(c.Writer)
	header := []string{"申请ID", "用户ID", "抬头", "纳税人识别号", "地址", "电话",
		"开户行", "账号", "金额", "币种", "收票邮箱", "关联订单号", "申请时间"}
	if err := writer.Write(header); err != nil {
		common.SysError("failed to write invoice csv header: " + err.Error())
		return
	}
	for _, request := range requests {
		row := []string{
			strconv.Itoa(request.Id),
			strconv.Itoa(request.UserId),
			csvSafeCell(request.Title),
			csvSafeCell(request.TaxNo),
			csvSafeCell(request.Address),
			csvSafeCell(request.Phone),
			csvSafeCell(request.BankName),
			csvSafeCell(request.BankAccount),
			// AmountTotal is in minor units (分/cents).
			strconv.FormatFloat(float64(request.AmountTotal)/100, 'f', 2, 64),
			csvSafeCell(request.Currency),
			csvSafeCell(request.RecipientEmail),
			csvSafeCell(request.TradeNoSnapshot),
			time.Unix(request.CreateTime, 0).Format("2006-01-02 15:04:05"),
		}
		if err := writer.Write(row); err != nil {
			common.SysError("failed to write invoice csv row: " + err.Error())
			return
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		common.SysError("failed to flush invoice csv: " + err.Error())
	}
}
