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

/**
 * Only a real public web address is accepted, because it is emailed to the
 * customer and used as a redirect target.
 *
 * A protocol check alone is not enough: `https://11111` parses fine, but the
 * host is a bare number that browsers resolve as an integer-form IPv4 address,
 * and the customer gets a security interstitial instead of their invoice. The
 * server repeats this check — this copy only spares the operator a round trip.
 */
export function isPublicHttpUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  const host = parsed.hostname
  // An IPv6 literal keeps its brackets in hostname; IPv4 is all digits and dots.
  if (host.startsWith('[') || /^[\d.]+$/.test(host)) return false

  const labels = host.split('.')
  const topLevel = labels.at(-1) ?? ''
  // Every real public suffix starts with a letter, punycode ones (xn--fiqs8s)
  // included. This is what rejects `11111`, `localhost` and `example.123`.
  return labels.length >= 2 && topLevel.length >= 2 && /^[a-z]/i.test(topLevel)
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
    // Optional: the uploaded attachment is the primary document now. The
    // "attachment or link" rule spans both fields, so it is enforced by the
    // dialog, which is what knows how many files are attached.
    pdf_url: z
      .string()
      .trim()
      .max(
        INVOICE_VALIDATION.PDF_URL_MAX_LENGTH,
        t(ERROR_MESSAGES.PDF_URL_INVALID)
      )
      .refine(
        (value) => value === '' || isPublicHttpUrl(value),
        t(ERROR_MESSAGES.PDF_URL_INVALID)
      ),
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
