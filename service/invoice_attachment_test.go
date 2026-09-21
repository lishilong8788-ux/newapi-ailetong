package service

import (
	"bytes"
	"mime/multipart"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// invoiceUploadHeader builds the multipart header an upload handler would hand to
// SaveInvoiceAttachment, so the validation is exercised through its real input
// type rather than a stand-in.
func invoiceUploadHeader(t *testing.T, fileName string, content []byte) *multipart.FileHeader {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", fileName)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	reader := multipart.NewReader(&body, writer.Boundary())
	form, err := reader.ReadForm(int64(body.Len()) + 1024)
	require.NoError(t, err)
	t.Cleanup(func() { _ = form.RemoveAll() })

	require.Len(t, form.File["file"], 1)
	return form.File["file"][0]
}

const testPdfSignature = "%PDF-1.7\n"

// The uploaded file is mailed out under the platform's name, so the extension and
// the magic bytes must agree. Trusting the extension alone would let an HTML or
// executable payload be delivered to a customer as their invoice; trusting the
// signature alone would accept a .pdf that is really a zip.
//
// Every case here is rejected before any disk or database access, which is what
// makes the invariant assertable without a fixture.
func TestSaveInvoiceAttachmentRejectsMismatchedContent(t *testing.T) {
	cases := []struct {
		name     string
		fileName string
		content  string
	}{
		{name: "html renamed to pdf", fileName: "invoice.pdf", content: "<html><body>hi</body></html>"},
		{name: "windows executable as pdf", fileName: "invoice.pdf", content: "MZ\x90\x00\x03"},
		{name: "zip claiming to be pdf", fileName: "invoice.pdf", content: "PK\x03\x04payload"},
		{name: "pdf bytes under ofd extension", fileName: "invoice.ofd", content: testPdfSignature},
		{name: "png bytes under jpg extension", fileName: "invoice.jpg", content: "\x89PNG\r\n\x1a\n"},
		{name: "unsupported extension", fileName: "invoice.exe", content: "MZ\x90\x00\x03"},
		{name: "no extension", fileName: "invoice", content: testPdfSignature},
		{name: "empty file", fileName: "invoice.pdf", content: ""},
		{name: "signature not at start", fileName: "invoice.pdf", content: "x" + testPdfSignature},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			header := invoiceUploadHeader(t, testCase.fileName, []byte(testCase.content))
			attachment, err := SaveInvoiceAttachment(1, 1, header)
			require.Error(t, err)
			assert.Nil(t, attachment)
		})
	}
}

// A file larger than the per-file cap must be refused on the bytes actually read,
// not on the client-declared length, because the declared size is part of the
// request the client controls.
func TestSaveInvoiceAttachmentRejectsOversizedContent(t *testing.T) {
	oversized := append([]byte(testPdfSignature),
		bytes.Repeat([]byte{0x41}, int(model.MaxInvoiceAttachmentBytes)+1)...)

	attachment, err := SaveInvoiceAttachment(1, 1, invoiceUploadHeader(t, "invoice.pdf", oversized))
	require.Error(t, err)
	assert.Nil(t, attachment)
	assert.Contains(t, err.Error(), "MB")
}

// ResolveInvoiceAttachmentPath is the one place a stored string becomes a
// filesystem read. A row edited by hand in the database must not be able to reach
// outside the storage root and serve an arbitrary file to a customer.
func TestResolveInvoiceAttachmentPathContainsStoredPath(t *testing.T) {
	root := t.TempDir()
	t.Setenv(invoiceStorageEnv, root)

	inside, err := ResolveInvoiceAttachmentPath("12/a3f2.pdf")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(root, "12", "a3f2.pdf"), inside)

	for _, escaping := range []string{
		"../escape.pdf",
		"12/../../escape.pdf",
		`..\escape.pdf`,
	} {
		resolved, err := ResolveInvoiceAttachmentPath(escaping)
		require.Error(t, err, "expected %q to be rejected", escaping)
		assert.Empty(t, resolved)
	}
}

// The browser-supplied name is shown to the operator and written into a mail
// header. It must be reduced to a bare base name, because a multipart part may
// legally carry a full path.
func TestInvoiceDisplayFileName(t *testing.T) {
	cases := []struct {
		name     string
		raw      string
		expected string
	}{
		{name: "plain name", raw: "增值税普通发票.pdf", expected: "增值税普通发票.pdf"},
		{name: "windows path", raw: `C:\Users\me\Desktop\invoice.pdf`, expected: "invoice.pdf"},
		{name: "posix path", raw: "/tmp/invoice.pdf", expected: "invoice.pdf"},
		{name: "traversal", raw: `..\..\invoice.pdf`, expected: "invoice.pdf"},
		{name: "control characters", raw: "inv\r\noice.pdf", expected: "invoice.pdf"},
		{name: "quotes", raw: `in"voice".pdf`, expected: "invoice.pdf"},
		{name: "dot dot only", raw: "..", expected: "invoice.pdf"},
		{name: "empty", raw: "", expected: "invoice.pdf"},
		{name: "path with empty base", raw: "folder/", expected: "invoice.pdf"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			assert.Equal(t, testCase.expected, invoiceDisplayFileName(testCase.raw, ".pdf"))
		})
	}
}

// The stored name has to fit varchar(255). Truncating by byte would cut a Chinese
// name mid-character and leave invalid UTF-8 in the column.
func TestInvoiceDisplayFileNameTruncatesByRune(t *testing.T) {
	long := strings.Repeat("发", 300) + ".pdf"

	result := invoiceDisplayFileName(long, ".pdf")

	assert.Equal(t, 200, len([]rune(result)))
	assert.True(t, utf8.ValidString(result))
}
