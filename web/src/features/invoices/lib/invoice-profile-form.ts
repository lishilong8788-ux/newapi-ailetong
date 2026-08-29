/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { INVOICE_PROFILE_VALIDATION } from '../constants'
import type { InvoiceProfile, InvoiceProfilePayload } from '../types'

// ============================================================================
// Invoice profile form schema (use getInvoiceProfileFormSchema(t) for i18n)
// ============================================================================

export function getInvoiceProfileFormSchema(t: TFunction) {
  return z
    .object({
      title_type: z.enum(['personal', 'company']),
      title: z
        .string()
        .trim()
        .min(1, t('Invoice title is required'))
        .max(
          INVOICE_PROFILE_VALIDATION.TITLE_MAX_LENGTH,
          t('Invoice title is too long')
        ),
      tax_no: z
        .string()
        .trim()
        .max(
          INVOICE_PROFILE_VALIDATION.TAX_NO_MAX_LENGTH,
          t('Tax ID is too long')
        ),
      address: z
        .string()
        .trim()
        .max(
          INVOICE_PROFILE_VALIDATION.ADDRESS_MAX_LENGTH,
          t('Address is too long')
        ),
      phone: z
        .string()
        .trim()
        .max(
          INVOICE_PROFILE_VALIDATION.PHONE_MAX_LENGTH,
          t('Phone number is too long')
        ),
      bank_name: z
        .string()
        .trim()
        .max(
          INVOICE_PROFILE_VALIDATION.BANK_NAME_MAX_LENGTH,
          t('Bank name is too long')
        ),
      bank_account: z
        .string()
        .trim()
        .max(
          INVOICE_PROFILE_VALIDATION.BANK_ACCOUNT_MAX_LENGTH,
          t('Bank account is too long')
        ),
      is_default: z.boolean(),
    })
    .refine(
      (values) => values.title_type !== 'company' || values.tax_no.length > 0,
      {
        path: ['tax_no'],
        message: t('Tax ID is required for a company invoice title'),
      }
    )
}

export type InvoiceProfileFormValues = {
  title_type: 'personal' | 'company'
  title: string
  tax_no: string
  address: string
  phone: string
  bank_name: string
  bank_account: string
  is_default: boolean
}

export const INVOICE_PROFILE_FORM_DEFAULT_VALUES: InvoiceProfileFormValues = {
  title_type: 'company',
  title: '',
  tax_no: '',
  address: '',
  phone: '',
  bank_name: '',
  bank_account: '',
  is_default: false,
}

/**
 * Build the API payload. A personal title has no tax number or bank details,
 * so those fields are cleared instead of carrying stale company values over.
 */
export function transformProfileFormToPayload(
  values: InvoiceProfileFormValues
): InvoiceProfilePayload {
  const isCompany = values.title_type === 'company'
  return {
    title_type: values.title_type,
    title: values.title.trim(),
    tax_no: isCompany ? values.tax_no.trim() : '',
    address: values.address.trim(),
    phone: values.phone.trim(),
    bank_name: isCompany ? values.bank_name.trim() : '',
    bank_account: isCompany ? values.bank_account.trim() : '',
    is_default: values.is_default,
  }
}

export function transformProfileToFormValues(
  profile: InvoiceProfile
): InvoiceProfileFormValues {
  return {
    title_type: profile.title_type,
    title: profile.title ?? '',
    tax_no: profile.tax_no ?? '',
    address: profile.address ?? '',
    phone: profile.phone ?? '',
    bank_name: profile.bank_name ?? '',
    bank_account: profile.bank_account ?? '',
    is_default: Boolean(profile.is_default),
  }
}
