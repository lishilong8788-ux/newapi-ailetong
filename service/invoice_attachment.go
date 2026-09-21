package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/google/uuid"
)

// invoiceStorageEnv names the directory invoice documents are kept in. It is a
// separate setting from the disk cache: a cache may be wiped at any time, while
// an issued invoice has to survive for the statutory retention period.
const invoiceStorageEnv = "INVOICE_STORAGE_PATH"

const defaultInvoiceStoragePath = "./data/invoices"

// invoiceStorageRoot resolves the absolute directory files are written under.
// Read on each call so an operator changing the environment does not need a
// rebuild, only a restart.
func invoiceStorageRoot() (string, error) {
	configured := strings.TrimSpace(common.GetEnvOrDefaultString(invoiceStorageEnv, defaultInvoiceStoragePath))
	if configured == "" {
		configured = defaultInvoiceStoragePath
	}
	absolute, err := filepath.Abs(configured)
	if err != nil {
		return "", fmt.Errorf("invalid %s: %w", invoiceStorageEnv, err)
	}
	return absolute, nil
}

// invoiceFileKind describes one accepted upload: the extension an operator
// picked, the MIME type sent to the mail client, and the leading bytes a genuine
// file of that kind starts with.
//
// Both the extension and the signature are checked. Trusting the extension alone
// would let an HTML or script file be mailed out under the platform's name;
// trusting the signature alone would accept a .pdf that is really a zip archive.
type invoiceFileKind struct {
	mimeType   string
	signatures [][]byte
}

var invoiceFileKinds = map[string]invoiceFileKind{
	".pdf": {mimeType: "application/pdf", signatures: [][]byte{[]byte("%PDF-")}},
	// OFD is the Chinese electronic invoice format and is a zip container, so it
	// carries the zip signature rather than one of its own.
	".ofd":  {mimeType: "application/ofd", signatures: [][]byte{{'P', 'K', 0x03, 0x04}}},
	".jpg":  {mimeType: "image/jpeg", signatures: [][]byte{{0xFF, 0xD8, 0xFF}}},
	".jpeg": {mimeType: "image/jpeg", signatures: [][]byte{{0xFF, 0xD8, 0xFF}}},
	".png":  {mimeType: "image/png", signatures: [][]byte{{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}}},
}

// InvoiceAttachmentAcceptList is the accept attribute the upload control offers.
var InvoiceAttachmentAcceptList = []string{".pdf", ".ofd", ".jpg", ".jpeg", ".png"}

var errInvoiceFileType = errors.New("unsupported invoice attachment type")

// invoiceDisplayFileName reduces the browser-supplied name to something safe to
// store, show and put in a mail header.
//
// Only the base name is kept: a multipart part may legally carry a full path, and
// on Windows a name like `..\..\x.pdf` would otherwise reach the display layer.
// The name never decides where the file is written — that is generated
// server-side — so this is about display and header safety, not path traversal.
func invoiceDisplayFileName(raw string, extension string) string {
	name := raw
	if index := strings.LastIndexAny(name, `/\`); index >= 0 {
		name = name[index+1:]
	}
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7F || r == '"' {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		name = "invoice" + extension
	}
	// The column is varchar(255); truncate by rune so a Chinese name is not cut
	// mid-character.
	if runes := []rune(name); len(runes) > 200 {
		name = string(runes[:200])
	}
	return name
}

// SaveInvoiceAttachment validates one uploaded file and stores it for a request.
//
// The stored path is generated server-side and recorded relative to the storage
// root, so the deployment can move or remount that directory without rewriting
// rows, and a client-supplied name never influences where bytes land.
func SaveInvoiceAttachment(requestId int, uploaderId int, header *multipart.FileHeader) (*model.InvoiceAttachment, error) {
	if header == nil {
		return nil, errors.New("请选择要上传的文件")
	}
	oversized := fmt.Errorf("单个附件不能超过 %d MB", model.MaxInvoiceAttachmentBytes>>20)
	if header.Size > model.MaxInvoiceAttachmentBytes {
		return nil, oversized
	}

	extension := strings.ToLower(filepath.Ext(header.Filename))
	kind, accepted := invoiceFileKinds[extension]
	if !accepted {
		return nil, errInvoiceFileType
	}

	opened, err := header.Open()
	if err != nil {
		return nil, errors.New("读取上传文件失败")
	}
	defer opened.Close()

	// header.Size is client-supplied, so the read is bounded independently and one
	// extra byte is requested to catch a body that understated its length.
	content, err := io.ReadAll(io.LimitReader(opened, model.MaxInvoiceAttachmentBytes+1))
	if err != nil {
		return nil, errors.New("读取上传文件失败")
	}
	if int64(len(content)) > model.MaxInvoiceAttachmentBytes {
		return nil, oversized
	}
	if len(content) == 0 {
		return nil, errors.New("上传的文件为空")
	}

	signatureMatched := false
	for _, signature := range kind.signatures {
		if bytes.HasPrefix(content, signature) {
			signatureMatched = true
			break
		}
	}
	if !signatureMatched {
		return nil, errInvoiceFileType
	}

	root, err := invoiceStorageRoot()
	if err != nil {
		return nil, err
	}
	relativeDir := strconv.Itoa(requestId)
	if err := os.MkdirAll(filepath.Join(root, relativeDir), 0o750); err != nil {
		common.SysError("failed to create invoice storage directory: " + err.Error())
		return nil, errors.New("发票附件存储目录不可写，请检查部署配置")
	}

	relativePath := filepath.ToSlash(filepath.Join(relativeDir, uuid.NewString()+extension))
	absolutePath := filepath.Join(root, filepath.FromSlash(relativePath))
	if err := os.WriteFile(absolutePath, content, 0o640); err != nil {
		common.SysError("failed to write invoice attachment: " + err.Error())
		return nil, errors.New("保存发票附件失败")
	}

	digest := sha256.Sum256(content)
	attachment := &model.InvoiceAttachment{
		RequestId:  requestId,
		FileName:   invoiceDisplayFileName(header.Filename, extension),
		StoredPath: relativePath,
		MimeType:   kind.mimeType,
		FileSize:   int64(len(content)),
		Sha256:     hex.EncodeToString(digest[:]),
		UploaderId: uploaderId,
	}
	if err := model.CreateInvoiceAttachment(attachment); err != nil {
		// The row is the record of truth; a file with no row is unreachable, so it
		// is removed rather than left to accumulate.
		if removeErr := os.Remove(absolutePath); removeErr != nil && !os.IsNotExist(removeErr) {
			common.SysError("failed to clean up orphaned invoice attachment: " + removeErr.Error())
		}
		return nil, err
	}
	return attachment, nil
}

// ResolveInvoiceAttachmentPath turns a stored relative path into an absolute one.
//
// Containment is re-checked even though the path was generated server-side: this
// is the single point where a stored string becomes a filesystem read, and a row
// edited by hand in the database must not be able to reach outside the storage
// root.
func ResolveInvoiceAttachmentPath(storedPath string) (string, error) {
	root, err := invoiceStorageRoot()
	if err != nil {
		return "", err
	}
	absolute := filepath.Join(root, filepath.FromSlash(storedPath))
	if absolute != root && !strings.HasPrefix(absolute, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("invoice attachment path escapes storage root: %s", storedPath)
	}
	return absolute, nil
}

// RemoveInvoiceAttachmentFiles unlinks files whose rows are already gone. Errors
// are logged rather than returned: the row is what the customer sees, so a
// leftover file must not fail the operation that removed it.
func RemoveInvoiceAttachmentFiles(storedPaths []string) {
	for _, storedPath := range storedPaths {
		absolute, err := ResolveInvoiceAttachmentPath(storedPath)
		if err != nil {
			common.SysError("failed to resolve invoice attachment for removal: " + err.Error())
			continue
		}
		if err := os.Remove(absolute); err != nil && !os.IsNotExist(err) {
			common.SysError("failed to remove invoice attachment file: " + err.Error())
		}
	}
}

// InvoiceMailAttachments loads a request's files for the notification mail.
//
// A file that cannot be read is reported rather than skipped: sending a mail that
// claims to carry the invoice but does not is worse than failing the send and
// letting the admin retry from the list.
func InvoiceMailAttachments(requestId int) ([]common.EmailAttachment, error) {
	stored, err := model.GetInvoiceAttachments(requestId)
	if err != nil {
		return nil, err
	}
	if len(stored) == 0 {
		return nil, nil
	}

	attachments := make([]common.EmailAttachment, 0, len(stored))
	for _, item := range stored {
		absolute, err := ResolveInvoiceAttachmentPath(item.StoredPath)
		if err != nil {
			return nil, err
		}
		content, err := os.ReadFile(absolute)
		if err != nil {
			return nil, fmt.Errorf("附件 %s 读取失败: %w", item.FileName, err)
		}
		attachments = append(attachments, common.EmailAttachment{
			FileName: item.FileName,
			MimeType: item.MimeType,
			Content:  content,
		})
	}
	return attachments, nil
}
