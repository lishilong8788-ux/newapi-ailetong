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

import { INVOICE_REQUEST_VALIDATION } from '../constants'
import type { InvoiceProfile } from '../types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ============================================================================
// Invoice request form schema (use getInvoiceRequestFormSchema(t) for i18n)
// ============================================================================

export function getInvoiceRequestFormSchema(t: TFunction) {
  return z.object({
    profile_id: z.number().int().positive(t('Please select an invoice title')),
    invoice_type: z.enum(['normal', 'special']),
    recipient_email: z
      .string()
      .trim()
      .min(1, t('Recipient email is required'))
      .max(
        INVOICE_REQUEST_VALIDATION.EMAIL_MAX_LENGTH,
        t('Recipient email is too long')
      )
      .regex(EMAIL_PATTERN, t('Enter a valid email address')),
    remark: z
      .string()
      .trim()
      .max(
        INVOICE_REQUEST_VALIDATION.REMARK_MAX_LENGTH,
        t('Remark is too long')
      ),
  })
}

export type InvoiceRequestFormValues = {
  profile_id: number
  invoice_type: 'normal' | 'special'
  recipient_email: string
  remark: string
}

export const INVOICE_REQUEST_FORM_DEFAULT_VALUES: InvoiceRequestFormValues = {
  profile_id: 0,
  invoice_type: 'normal',
  recipient_email: '',
  remark: '',
}

/**
 * A special VAT invoice needs the seller's bank details, so the chosen profile
 * has to carry both before the request can be submitted.
 */
export function isProfileReadyForSpecialInvoice(
  profile: InvoiceProfile | undefined
): boolean {
  if (!profile) return false
  return (
    profile.bank_name.trim().length > 0 &&
    profile.bank_account.trim().length > 0
  )
}
