package common

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// parseBuiltMail reads a message produced by buildMailMessage the way a mail
// client would, so the tests assert on the parsed structure instead of on
// hand-matched substrings.
func parseBuiltMail(t *testing.T, raw []byte) (*mail.Message, string) {
	t.Helper()
	message, err := mail.ReadMessage(bytes.NewReader(raw))
	require.NoError(t, err)

	mediaType, params, err := mime.ParseMediaType(message.Header.Get("Content-Type"))
	require.NoError(t, err)
	return message, mediaType + "|" + params["boundary"]
}

// Every existing caller of SendEmail sends a single HTML body. Adding attachment
// support must not turn those messages into multipart, or a plain verification
// code mail starts rendering as a file listing in some clients.
func TestBuildMailMessageWithoutAttachmentsStaysSinglePart(t *testing.T) {
	withSMTPSettings(t)
	SMTPFrom = "billing@example.com"
	SystemName = "New API"

	raw := buildMailMessage("Verification", "user@example.com", "<id@example.com>", "<p>123456</p>", nil)

	message, contentType := parseBuiltMail(t, raw)
	assert.Equal(t, "text/html|", contentType)
	assert.Equal(t, "1.0", message.Header.Get("MIME-Version"))

	body, err := io.ReadAll(message.Body)
	require.NoError(t, err)
	assert.Contains(t, string(body), "<p>123456</p>")
}

// An issued invoice is mailed as a real file. The part has to survive a standard
// MIME parse with its bytes and its Chinese file name intact, because the
// recipient is often a finance mailbox that only keeps the attachment.
func TestBuildMailMessageAttachesFileWithDecodableContent(t *testing.T) {
	withSMTPSettings(t)
	SMTPFrom = "billing@example.com"
	SystemName = "康贝斯·算力云"

	// Long enough to force several base64 lines, and binary so a text-only
	// encoding path would corrupt it.
	pdfContent := append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte{0x00, 0x01, 0xFE, 0xFF}, 64)...)
	raw := buildMailMessage(
		"发票已开出", "finance@example.com", "<id@example.com>", "<p>发票在附件中</p>",
		[]EmailAttachment{{FileName: "增值税普通发票.pdf", MimeType: "application/pdf", Content: pdfContent}},
	)

	message, contentType := parseBuiltMail(t, raw)
	mediaType, boundary, found := strings.Cut(contentType, "|")
	require.True(t, found)
	require.Equal(t, "multipart/mixed", mediaType)
	require.NotEmpty(t, boundary)

	reader := multipart.NewReader(message.Body, boundary)

	htmlPart, err := reader.NextPart()
	require.NoError(t, err)
	htmlBody, err := io.ReadAll(htmlPart)
	require.NoError(t, err)
	assert.Contains(t, htmlPart.Header.Get("Content-Type"), "text/html")
	assert.Contains(t, string(htmlBody), "<p>发票在附件中</p>")

	filePart, err := reader.NextPart()
	require.NoError(t, err)
	assert.Equal(t, "base64", filePart.Header.Get("Content-Transfer-Encoding"))
	// FileName() decodes the RFC 2047 encoded-word, which is what proves the
	// Chinese name reaches the client unmangled.
	assert.Equal(t, "增值税普通发票.pdf", filePart.FileName())

	encoded, err := io.ReadAll(filePart)
	require.NoError(t, err)
	for _, line := range strings.Split(strings.TrimSpace(string(encoded)), "\n") {
		assert.LessOrEqual(t, len(strings.TrimRight(line, "\r")), base64LineWidth)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.NewReplacer("\r", "", "\n", "").Replace(string(encoded)))
	require.NoError(t, err)
	assert.Equal(t, pdfContent, decoded)

	_, err = reader.NextPart()
	assert.ErrorIs(t, err, io.EOF)
}

// The file name and MIME type are written into MIME headers. A name carrying
// CRLF would otherwise let a stored value forge headers on a message the
// platform signs its own name to.
func TestBuildMailMessageStripsHeaderInjectionFromAttachmentName(t *testing.T) {
	withSMTPSettings(t)
	SMTPFrom = "billing@example.com"
	SystemName = "New API"

	raw := buildMailMessage(
		"发票已开出", "finance@example.com", "<id@example.com>", "<p>body</p>",
		[]EmailAttachment{{
			FileName: "invoice\r\nBcc: attacker@evil.example\r\n\"quoted\".pdf",
			MimeType: "application/pdf\r\nX-Injected: yes",
			Content:  []byte("%PDF-1.7\n"),
		}},
	)

	message, contentType := parseBuiltMail(t, raw)
	// The injected text may survive inside a quoted parameter value, which is
	// inert. What must not happen is it becoming a header of its own.
	assert.Empty(t, message.Header.Get("Bcc"))
	assert.Empty(t, message.Header.Get("X-Injected"))

	mediaType, boundary, found := strings.Cut(contentType, "|")
	require.True(t, found)
	require.Equal(t, "multipart/mixed", mediaType)

	reader := multipart.NewReader(message.Body, boundary)
	_, err := reader.NextPart()
	require.NoError(t, err)
	filePart, err := reader.NextPart()
	require.NoError(t, err)

	// A MIME type that is not a bare type/subtype is replaced outright rather
	// than smuggled into the header.
	partType, _, err := mime.ParseMediaType(filePart.Header.Get("Content-Type"))
	require.NoError(t, err)
	assert.Equal(t, "application/octet-stream", partType)
	assert.NotContains(t, filePart.FileName(), "\r")
	assert.NotContains(t, filePart.FileName(), "\n")

	_, err = reader.NextPart()
	assert.ErrorIs(t, err, io.EOF)
}
