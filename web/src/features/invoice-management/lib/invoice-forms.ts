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

import dayjs from '@/lib/dayjs'

import { ERROR_MESSAGES, INVOICE_VALIDATION } from '../constants'
import type { IssueInvoicePayload, RejectInvoicePayload } from '../types'

// ============================================================================
// Issue Form
// ============================================================================

export type IssueInvoiceFormValues = {
  invoice_no: string
  pdf_url: string
  issue_date?: Date
  notify_email: boolean
}

/** Only web links are accepted: the address is emailed to the customer. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function getIssueInvoiceFormSchema(t: TFunction) {
  return z.object({
    invoice_no: z
      .string()
      .trim()
      .min(1, t(ERROR_MESSAGES.INVOICE_NO_REQUIRED))
      .max(
        INVOICE_VALIDATION.INVOICE_NO_MAX_LENGTH,
        t(ERROR_MESSAGES.INVOICE_NO_REQUIRED)
      ),
    pdf_url: z
      .string()
      .trim()
      .min(1, t(ERROR_MESSAGES.PDF_URL_REQUIRED))
      .max(
        INVOICE_VALIDATION.PDF_URL_MAX_LENGTH,
        t(ERROR_MESSAGES.PDF_URL_INVALID)
      )
      .refine(isHttpUrl, t(ERROR_MESSAGES.PDF_URL_INVALID)),
    issue_date: z.date().optional(),
    notify_email: z.boolean(),
  })
}

export function getIssueInvoiceFormDefaults(): IssueInvoiceFormValues {
  return {
    invoice_no: '',
    pdf_url: '',
    issue_date: new Date(),
    notify_email: true,
  }
}

export function toIssueInvoicePayload(
  values: IssueInvoiceFormValues
): IssueInvoicePayload {
  return {
    invoice_no: values.invoice_no.trim(),
    pdf_url: values.pdf_url.trim(),
    issue_date: values.issue_date
      ? dayjs(values.issue_date).format('YYYY-MM-DD')
      : undefined,
    notify_email: values.notify_email,
  }
}

// ============================================================================
// Reject Form
// ============================================================================

export type RejectInvoiceFormValues = {
  reason: string
}

export function getRejectInvoiceFormSchema(t: TFunction) {
  return z.object({
    reason: z
      .string()
      .trim()
      .min(
        INVOICE_VALIDATION.REJECT_REASON_MIN_LENGTH,
        t(ERROR_MESSAGES.REJECT_REASON_TOO_SHORT, {
          min: INVOICE_VALIDATION.REJECT_REASON_MIN_LENGTH,
        })
      )
      .max(
        INVOICE_VALIDATION.REJECT_REASON_MAX_LENGTH,
        t(ERROR_MESSAGES.REJECT_REASON_TOO_LONG, {
          max: INVOICE_VALIDATION.REJECT_REASON_MAX_LENGTH,
        })
      ),
  })
}

export const REJECT_INVOICE_FORM_DEFAULTS: RejectInvoiceFormValues = {
  reason: '',
}

export function toRejectInvoicePayload(
  values: RejectInvoiceFormValues
): RejectInvoicePayload {
  return { reason: values.reason.trim() }
}
