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
import type { StatusBadgeProps } from '@/components/status-badge'

import type { InvoiceStatus } from './types'

// ============================================================================
// Status Tabs & Badges
// ============================================================================

/** Sentinel tab value meaning "no status filter". */
export const INVOICE_STATUS_TAB_ALL = 'all'

/** Tab order mirrors the finance workflow: newest work first. */
export const INVOICE_STATUS_TABS = [
  'pending',
  'issued',
  'rejected',
  INVOICE_STATUS_TAB_ALL,
] as const

/**
 * Tab selected when the URL carries no `status`. The page opens on the queue
 * that needs a decision rather than on the full history.
 */
export const INVOICE_STATUS_TAB_DEFAULT = 'pending'

export type InvoiceStatusTab = (typeof INVOICE_STATUS_TABS)[number]

// labelKey values are i18n keys; use t(config.labelKey) in components
export const INVOICE_STATUSES: Record<
  InvoiceStatus,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  pending: { labelKey: 'Pending', variant: 'warning' },
  issued: { labelKey: 'Issued', variant: 'success' },
  rejected: { labelKey: 'Rejected', variant: 'danger' },
  cancelled: { labelKey: 'Cancelled', variant: 'neutral' },
}

export const INVOICE_STATUS_TAB_LABEL_KEYS: Record<InvoiceStatusTab, string> = {
  pending: 'Pending',
  issued: 'Issued',
  rejected: 'Rejected',
  [INVOICE_STATUS_TAB_ALL]: 'All',
}

export const INVOICE_TITLE_TYPE_LABEL_KEYS = {
  personal: 'Personal',
  company: 'Company',
} as const

export const INVOICE_TYPE_LABEL_KEYS = {
  normal: 'General VAT Invoice',
  special: 'Special VAT Invoice',
} as const

// ============================================================================
// Validation Constants
// ============================================================================

/** Mirrors the server-side attachment limits in model/invoice.go. */
export const INVOICE_ATTACHMENT = {
  MAX_FILES: 5,
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  MAX_TOTAL_BYTES: 15 * 1024 * 1024,
  ACCEPT: '.pdf,.ofd,.jpg,.jpeg,.png',
} as const

export const INVOICE_VALIDATION = {
  INVOICE_NO_MAX_LENGTH: 64,
  PDF_URL_MAX_LENGTH: 1024,
  REJECT_REASON_MIN_LENGTH: 5,
  REJECT_REASON_MAX_LENGTH: 500,
} as const

// ============================================================================
// Messages (i18n keys; use t(MESSAGES.xxx) when displaying)
// ============================================================================

export const ERROR_MESSAGES = {
  LOAD_FAILED: 'Failed to load invoice requests',
  DETAIL_FAILED: 'Failed to load invoice request detail',
  ISSUE_FAILED: 'Failed to issue invoice',
  REJECT_FAILED: 'Failed to reject invoice request',
  RESEND_FAILED: 'Failed to resend the invoice email',
  EXPORT_FAILED: 'Failed to export the pending invoice list',
  INVOICE_NO_REQUIRED: 'Invoice number is required',
  PDF_URL_INVALID:
    'PDF link must be a public http or https address, not an IP or a bare name',
  DOCUMENT_REQUIRED: 'Upload the invoice file, or fill in a PDF link',
  ATTACHMENT_UPLOAD_FAILED: 'Failed to upload the attachment',
  ATTACHMENT_DELETE_FAILED: 'Failed to remove the attachment',
  ATTACHMENT_TOO_LARGE: 'Each attachment must be under {{max}} MB',
  ATTACHMENT_TOTAL_TOO_LARGE:
    'Attachments must total under {{max}} MB so the email can carry them',
  ATTACHMENT_TYPE_UNSUPPORTED: 'Only PDF, OFD, JPG and PNG files are accepted',
  REJECT_REASON_TOO_SHORT:
    'Reject reason must be at least {{min}} characters long',
  REJECT_REASON_TOO_LONG: 'Reject reason must be at most {{max}} characters',
} as const

export const SUCCESS_MESSAGES = {
  ATTACHMENT_UPLOADED: 'Attachment uploaded',
  ATTACHMENT_DELETED: 'Attachment removed',
  INVOICE_ISSUED: 'Invoice issued successfully',
  INVOICE_REJECTED: 'Invoice request rejected',
  EMAIL_RESENT: 'Invoice email resent',
  EXPORTED: 'Pending invoice list exported',
} as const
