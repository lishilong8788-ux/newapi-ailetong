package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

func (p *InvoiceProfile) normalize() {
	p.Title = strings.TrimSpace(p.Title)
	p.TaxNo = strings.TrimSpace(p.TaxNo)
	p.Address = strings.TrimSpace(p.Address)
	p.Phone = strings.TrimSpace(p.Phone)
	p.BankName = strings.TrimSpace(p.BankName)
	p.BankAccount = strings.TrimSpace(p.BankAccount)
	if p.TitleType != InvoiceTitleTypePersonal {
		p.TitleType = InvoiceTitleTypeCompany
	}
	// A personal title has no tax registration or bank account.
	if p.TitleType == InvoiceTitleTypePersonal {
		p.TaxNo = ""
		p.BankName = ""
		p.BankAccount = ""
	}
}

// clearOtherDefaults keeps at most one default profile per user.
func clearOtherDefaults(tx *gorm.DB, userId int, keepId int) error {
	return tx.Model(&InvoiceProfile{}).
		Where("user_id = ? AND id <> ? AND is_default = ?", userId, keepId, true).
		Update("is_default", false).Error
}

func GetUserInvoiceProfiles(userId int) ([]*InvoiceProfile, error) {
	var profiles []*InvoiceProfile
	err := DB.Where("user_id = ?", userId).
		Order("is_default desc, id desc").
		Find(&profiles).Error
	return profiles, err
}

func GetInvoiceProfileById(id int, userId int) (*InvoiceProfile, error) {
	var profile InvoiceProfile
	if err := DB.Where("id = ? AND user_id = ?", id, userId).First(&profile).Error; err != nil {
		return nil, ErrInvoiceProfileNotFound
	}
	return &profile, nil
}

func (p *InvoiceProfile) Insert() error {
	p.normalize()
	now := common.GetTimestamp()
	p.CreatedAt = now
	p.UpdatedAt = now

	return DB.Transaction(func(tx *gorm.DB) error {
		// The first profile a user creates becomes the default regardless of
		// what the client sent, so a submission form always has a preselection.
		var count int64
		if err := tx.Model(&InvoiceProfile{}).Where("user_id = ?", p.UserId).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			p.IsDefault = true
		}
		if err := tx.Create(p).Error; err != nil {
			return err
		}
		if p.IsDefault {
			return clearOtherDefaults(tx, p.UserId, p.Id)
		}
		return nil
	})
}

func (p *InvoiceProfile) Update() error {
	p.normalize()
	p.UpdatedAt = common.GetTimestamp()

	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&InvoiceProfile{}).
			Where("id = ? AND user_id = ?", p.Id, p.UserId).
			Select("title_type", "title", "tax_no", "address", "phone",
				"bank_name", "bank_account", "is_default", "updated_at").
			Updates(p)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrInvoiceProfileNotFound
		}
		if p.IsDefault {
			return clearOtherDefaults(tx, p.UserId, p.Id)
		}
		return nil
	})
}

// DeleteInvoiceProfile removes a title. Issued invoices keep their own snapshot,
// so deleting a profile never rewrites history.
func DeleteInvoiceProfile(id int, userId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var profile InvoiceProfile
		if err := tx.Where("id = ? AND user_id = ?", id, userId).First(&profile).Error; err != nil {
			return ErrInvoiceProfileNotFound
		}
		if err := tx.Delete(&InvoiceProfile{}, "id = ? AND user_id = ?", id, userId).Error; err != nil {
			return err
		}
		if !profile.IsDefault {
			return nil
		}
		// Promote the newest remaining profile so the user is never left
		// without a default.
		var next InvoiceProfile
		if err := tx.Where("user_id = ?", userId).Order("id desc").First(&next).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil
			}
			return err
		}
		return tx.Model(&InvoiceProfile{}).Where("id = ?", next.Id).
			Update("is_default", true).Error
	})
}
