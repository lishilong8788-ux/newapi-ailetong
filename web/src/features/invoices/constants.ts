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

import type { StatusBadgeProps } from '@/components/status-badge'

import type {
  InvoiceRequestStatus,
  InvoiceTitleType,
  InvoiceType,
} from './types'

// ============================================================================
// Tabs
// ============================================================================

export const INVOICE_TABS = {
  PENDING: 'pending',
  REQUESTS: 'requests',
  PROFILES: 'profiles',
} as const

export type InvoiceTabId = (typeof INVOICE_TABS)[keyof typeof INVOICE_TABS]

export const INVOICE_TAB_IDS: InvoiceTabId[] = [
  INVOICE_TABS.PENDING,
  INVOICE_TABS.REQUESTS,
  INVOICE_TABS.PROFILES,
]

/** labelKey values are i18n keys; render with t(labelKey) */
export const INVOICE_TAB_LABEL_KEYS: Record<InvoiceTabId, string> = {
  [INVOICE_TABS.PENDING]: 'Pending Invoicing',
  [INVOICE_TABS.REQUESTS]: 'My Invoices',
  [INVOICE_TABS.PROFILES]: 'Invoice Profiles',
}

// ============================================================================
// Invoicing notice
// ============================================================================

/**
 * Bullet points shown in the page header. Values are i18n keys.
 *
 * The 12-month figure mirrors `invoiceableWindowSeconds` in `model/invoice.go`;
 * change both together.
 */
export const INVOICE_NOTICE_KEYS: string[] = [
  'Invoice requests are reviewed by our finance team; you will be notified by email once issued.',
  'Paid orders can be invoiced right away, with no need to wait for the quota to be consumed.',
  'Orders paid within the last 12 months are eligible for invoicing.',
]

// ============================================================================
// Request status
// ============================================================================

/** labelKey values are i18n keys; render with t(config.labelKey) */
export const INVOICE_STATUS_CONFIG: Record<
  InvoiceRequestStatus,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  pending: { labelKey: 'Pending Issue', variant: 'warning' },
  issued: { labelKey: 'Issued', variant: 'success' },
  rejected: { labelKey: 'Rejected', variant: 'danger' },
  cancelled: { labelKey: 'Cancelled', variant: 'neutral' },
}

/** Filter value that means "no status filter" */
export const INVOICE_STATUS_FILTER_ALL = 'all'

export function getInvoiceStatusFilterOptions(t: TFunction) {
  return [
    { label: t('All Statuses'), value: INVOICE_STATUS_FILTER_ALL },
    ...(Object.keys(INVOICE_STATUS_CONFIG) as InvoiceRequestStatus[]).map(
      (status) => ({
        label: t(INVOICE_STATUS_CONFIG[status].labelKey),
        value: status,
      })
    ),
  ]
}

// ============================================================================
// Title type / invoice type
// ============================================================================

/** labelKey values are i18n keys; render with t(labelKey) */
export const INVOICE_TITLE_TYPE_LABEL_KEYS: Record<InvoiceTitleType, string> = {
  company: 'Company',
  personal: 'Individual',
}

/** labelKey values are i18n keys; render with t(labelKey) */
export const INVOICE_TYPE_LABEL_KEYS: Record<InvoiceType, string> = {
  normal: 'General Invoice',
  special: 'Special VAT Invoice',
}

// ============================================================================
// Validation
// ============================================================================

export const INVOICE_PROFILE_VALIDATION = {
  TITLE_MAX_LENGTH: 100,
  TAX_NO_MAX_LENGTH: 30,
  ADDRESS_MAX_LENGTH: 200,
  PHONE_MAX_LENGTH: 30,
  BANK_NAME_MAX_LENGTH: 100,
  BANK_ACCOUNT_MAX_LENGTH: 50,
} as const

export const INVOICE_REQUEST_VALIDATION = {
  REMARK_MAX_LENGTH: 200,
  EMAIL_MAX_LENGTH: 200,
} as const

export const INVOICE_LIST_PAGE_SIZE = 10

// ============================================================================
// Messages (i18n keys; render with t(MESSAGE))
// ============================================================================

export const SUCCESS_MESSAGES = {
  PROFILE_CREATED: 'Invoice profile created successfully',
  PROFILE_UPDATED: 'Invoice profile updated successfully',
  PROFILE_DELETED: 'Invoice profile deleted successfully',
  PROFILE_SET_DEFAULT: 'Default invoice profile updated',
  REQUEST_CREATED: 'Invoice request submitted successfully',
  REQUEST_CANCELLED: 'Invoice request cancelled successfully',
} as const

export const ERROR_MESSAGES = {
  PROFILES_LOAD_FAILED: 'Failed to load invoice profiles',
  ORDERS_LOAD_FAILED: 'Failed to load invoiceable orders',
  REQUESTS_LOAD_FAILED: 'Failed to load invoices',
  PROFILE_SAVE_FAILED: 'Failed to save invoice profile',
  PROFILE_DELETE_FAILED: 'Failed to delete invoice profile',
  REQUEST_CREATE_FAILED: 'Failed to submit invoice request',
  REQUEST_CANCEL_FAILED: 'Failed to cancel invoice request',
  MIXED_CURRENCY: 'Selected orders use different currencies',
  SPECIAL_INVOICE_BANK_REQUIRED:
    'A special VAT invoice requires the bank name and bank account on the selected profile',
} as const
