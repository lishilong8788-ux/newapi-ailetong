package common

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"mime"
	"net/smtp"
	"slices"
	"strings"
	"time"
)

func generateMessageID() (string, error) {
	split := strings.Split(SMTPFrom, "@")
	if len(split) < 2 {
		return "", fmt.Errorf("invalid SMTP account")
	}
	domain := strings.Split(SMTPFrom, "@")[1]
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), GetRandomString(12), domain), nil
}

func shouldUseSMTPLoginAuth() bool {
	if SMTPForceAuthLogin {
		return true
	}
	return isOutlookServer(SMTPAccount) || slices.Contains(EmailLoginAuthServerList, SMTPServer)
}

func getSMTPAuth() smtp.Auth {
	return AutoSMTPAuth(SMTPAccount, SMTPToken)
}

func shouldAuthenticateSMTP() bool {
	return SMTPAccount != "" && SMTPToken != ""
}

func smtpTLSConfig() *tls.Config {
	return &tls.Config{
		ServerName:         SMTPServer,
		InsecureSkipVerify: SMTPInsecureSkipVerify, // #nosec G402 -- admin-controlled SMTP compatibility option.
	}
}

func newSMTPClient(addr string) (*smtp.Client, error) {
	if SMTPSSLEnabled || (SMTPPort == 465 && !SMTPStartTLSEnabled) {
		conn, err := tls.Dial("tcp", addr, smtpTLSConfig())
		if err != nil {
			return nil, err
		}
		client, err := smtp.NewClient(conn, SMTPServer)
		if err != nil {
			_ = conn.Close()
			return nil, err
		}
		return client, nil
	}

	client, err := smtp.Dial(addr)
	if err != nil {
		return nil, err
	}

	if SMTPStartTLSEnabled {
		startTLSSupported, _ := client.Extension("STARTTLS")
		if !startTLSSupported {
			_ = client.Close()
			return nil, fmt.Errorf("SMTP server does not support STARTTLS")
		}
		if err := client.StartTLS(smtpTLSConfig()); err != nil {
			_ = client.Close()
			return nil, err
		}
	}

	return client, nil
}

// EmailAttachment is one file to be attached to an outgoing mail. Content is
// held in memory and base64-encoded into the message, so callers must bound the
// size before building one.
type EmailAttachment struct {
	FileName string
	MimeType string
	Content  []byte
}

// base64LineWidth wraps the encoded payload: RFC 2045 caps a MIME line at 76
// characters and some servers reject longer ones outright.
const base64LineWidth = 76

// mailHeaderValueCleaner strips the characters that would let a file name break
// out of the header it is written into.
var mailHeaderValueCleaner = strings.NewReplacer("\r", "", "\n", "", "\"", "")

// writeMailAttachment appends one base64 MIME part.
//
// Both headers are rendered by mime.FormatMediaType, which applies the RFC 2231
// parameter encoding. Invoice files are routinely named in Chinese, and an
// RFC 2047 encoded-word is not legal in a parameter value: standards-compliant
// parsers hand the client the raw `=?UTF-8?b?...?=` text as the file name.
func writeMailAttachment(buf *bytes.Buffer, boundary string, attachment EmailAttachment) {
	// The type is validated rather than merely stripped of newlines, so a value
	// that is not a bare `type/subtype` cannot reach the header at all.
	mimeType := "application/octet-stream"
	if parsed, _, err := mime.ParseMediaType(attachment.MimeType); err == nil && parsed != "" {
		mimeType = parsed
	}
	// Control characters and quotes are removed before encoding: they would be
	// escaped rather than rejected, leaving a file name the customer cannot read.
	fileName := mailHeaderValueCleaner.Replace(attachment.FileName)

	contentType := mime.FormatMediaType(mimeType, map[string]string{"name": fileName})
	if contentType == "" {
		contentType = mimeType
	}
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": fileName})
	if disposition == "" {
		disposition = "attachment"
	}

	fmt.Fprintf(buf, "--%s\r\n", boundary)
	fmt.Fprintf(buf, "Content-Type: %s\r\n", contentType)
	buf.WriteString("Content-Transfer-Encoding: base64\r\n")
	fmt.Fprintf(buf, "Content-Disposition: %s\r\n\r\n", disposition)

	encoded := base64.StdEncoding.EncodeToString(attachment.Content)
	for start := 0; start < len(encoded); start += base64LineWidth {
		end := min(start+base64LineWidth, len(encoded))
		buf.WriteString(encoded[start:end])
		buf.WriteString("\r\n")
	}
}

// buildMailMessage renders the RFC 5322 message. Without attachments it stays a
// single text/html body, which is what every existing caller sends; with them it
// becomes multipart/mixed.
func buildMailMessage(subject, receiver, messageID, content string, attachments []EmailAttachment) []byte {
	encodedSubject := fmt.Sprintf("=?UTF-8?B?%s?=", base64.StdEncoding.EncodeToString([]byte(subject)))

	var buf bytes.Buffer
	fmt.Fprintf(&buf, "To: %s\r\n", receiver)
	fmt.Fprintf(&buf, "From: %s <%s>\r\n", SystemName, SMTPFrom)
	fmt.Fprintf(&buf, "Subject: %s\r\n", encodedSubject)
	fmt.Fprintf(&buf, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	fmt.Fprintf(&buf, "Message-ID: %s\r\n", messageID)
	buf.WriteString("MIME-Version: 1.0\r\n")

	if len(attachments) == 0 {
		fmt.Fprintf(&buf, "Content-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n", content)
		return buf.Bytes()
	}

	boundary := "newapi-" + GetRandomString(24)
	fmt.Fprintf(&buf, "Content-Type: multipart/mixed; boundary=\"%s\"\r\n\r\n", boundary)
	fmt.Fprintf(&buf, "--%s\r\n", boundary)
	buf.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	buf.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	buf.WriteString(content)
	buf.WriteString("\r\n")
	for _, attachment := range attachments {
		writeMailAttachment(&buf, boundary, attachment)
	}
	fmt.Fprintf(&buf, "--%s--\r\n", boundary)
	return buf.Bytes()
}

func SendEmail(subject string, receiver string, content string) error {
	return SendEmailWithAttachments(subject, receiver, content, nil)
}

// SendEmailWithAttachments sends an HTML mail that carries files. Used for
// transactional documents such as an issued invoice, where a link is not enough
// because the recipient is often a finance mailbox with no platform account.
func SendEmailWithAttachments(subject string, receiver string, content string, attachments []EmailAttachment) error {
	if SMTPFrom == "" { // for compatibility
		SMTPFrom = SMTPAccount
	}
	id, err2 := generateMessageID()
	if err2 != nil {
		return err2
	}
	if SMTPServer == "" && SMTPAccount == "" {
		return fmt.Errorf("SMTP 服务器未配置")
	}
	mail := buildMailMessage(subject, receiver, id, content, attachments)
	auth := getSMTPAuth()
	addr := fmt.Sprintf("%s:%d", SMTPServer, SMTPPort)
	to := strings.Split(receiver, ";")
	var err error
	client, err := newSMTPClient(addr)
	if err != nil {
		return err
	}
	defer client.Close()
	if shouldAuthenticateSMTP() {
		if err = client.Auth(auth); err != nil {
			return err
		}
	}
	if err = client.Mail(SMTPFrom); err != nil {
		return err
	}
	for _, receiver := range to {
		if err = client.Rcpt(receiver); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	_, err = w.Write(mail)
	if err != nil {
		return err
	}
	err = w.Close()
	if err != nil {
		return err
	}
	err = client.Quit()
	if err != nil {
		SysError(fmt.Sprintf("failed to send email to %s: %v", receiver, err))
	}
	return err
}
