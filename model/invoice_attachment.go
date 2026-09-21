package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// CreateInvoiceAttachment records one uploaded file against a request.
//
// The per-request cap is enforced inside a transaction with the row locked, so
// two operators uploading at the same moment cannot both pass the count check.
func CreateInvoiceAttachment(attachment *InvoiceAttachment) error {
	if attachment.CreateTime <= 0 {
		attachment.CreateTime = common.GetTimestamp()
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var request InvoiceRequest
		if err := lockForUpdate(tx).Where("id = ?", attachment.RequestId).First(&request).Error; err != nil {
			return ErrInvoiceRequestNotFound
		}
		var existing []InvoiceAttachment
		if err := tx.Where("request_id = ?", attachment.RequestId).Find(&existing).Error; err != nil {
			return err
		}
		if len(existing) >= MaxInvoiceAttachmentsPerItem {
			return ErrInvoiceAttachmentLimit
		}
		total := attachment.FileSize
		for _, stored := range existing {
			total += stored.FileSize
		}
		if total > MaxInvoiceAttachmentTotalBytes {
			return ErrInvoiceAttachmentQuota
		}
		return tx.Create(attachment).Error
	})
}

func GetInvoiceAttachments(requestId int) ([]*InvoiceAttachment, error) {
	var attachments []*InvoiceAttachment
	err := DB.Where("request_id = ?", requestId).Order("id asc").Find(&attachments).Error
	return attachments, err
}

// GetInvoiceAttachmentById reads one attachment. A userId of 0 means an admin
// read; any positive userId must own the parent request, because the file is the
// invoice document itself.
func GetInvoiceAttachmentById(id int, requestId int, userId int) (*InvoiceAttachment, error) {
	var attachment InvoiceAttachment
	query := DB.Where("id = ?", id)
	if requestId > 0 {
		query = query.Where("request_id = ?", requestId)
	}
	if err := query.First(&attachment).Error; err != nil {
		return nil, ErrInvoiceAttachmentNotFnd
	}
	if userId > 0 {
		if _, err := GetInvoiceRequestById(attachment.RequestId, userId); err != nil {
			return nil, ErrInvoiceAttachmentNotFnd
		}
	}
	return &attachment, nil
}

// DeleteInvoiceAttachment removes one attachment row and returns its stored path
// so the caller can unlink the file. The row is dropped first on purpose: a
// leftover file wastes disk, but a row pointing at a deleted file would surface
// to the customer as a broken download.
func DeleteInvoiceAttachment(id int, requestId int) (string, error) {
	attachment, err := GetInvoiceAttachmentById(id, requestId, 0)
	if err != nil {
		return "", err
	}
	if err := DB.Where("id = ?", attachment.Id).Delete(&InvoiceAttachment{}).Error; err != nil {
		return "", err
	}
	return attachment.StoredPath, nil
}

// releaseInvoiceAttachmentRows drops every attachment row of one request inside
// the caller's transaction and returns the stored paths, so the status change and
// the loss of the document commit together or not at all.
func releaseInvoiceAttachmentRows(tx *gorm.DB, requestId int) ([]string, error) {
	var attachments []InvoiceAttachment
	if err := tx.Where("request_id = ?", requestId).Find(&attachments).Error; err != nil {
		return nil, err
	}
	if len(attachments) == 0 {
		return nil, nil
	}
	if err := tx.Where("request_id = ?", requestId).Delete(&InvoiceAttachment{}).Error; err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(attachments))
	for _, attachment := range attachments {
		paths = append(paths, attachment.StoredPath)
	}
	return paths, nil
}

// CountInvoiceAttachments reports how many files a request already has. Issuing
// uses it to decide whether a PDF link is still mandatory.
func CountInvoiceAttachments(requestId int) (int64, error) {
	var count int64
	err := DB.Model(&InvoiceAttachment{}).Where("request_id = ?", requestId).Count(&count).Error
	return count, err
}
