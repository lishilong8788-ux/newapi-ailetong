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

import type {
  AgentCommissionStatus,
  AgentStatus,
  AgentWithdrawalMethod,
  AgentWithdrawalStatus,
} from './types'

// ============================================================================
// Status Badges (labelKey values are i18n keys; use t(config.labelKey))
// ============================================================================

type BadgeConfig = Pick<StatusBadgeProps, 'variant'> & { labelKey: string }

export const AGENT_STATUSES: Record<AgentStatus, BadgeConfig> = {
  // Only an operator adding an agent in the admin console produces this state,
  // so it reads as "we are waiting on them", not "they left a form half done".
  incomplete: { labelKey: 'Awaiting Application', variant: 'warning' },
  pending: { labelKey: 'Under Review', variant: 'info' },
  active: { labelKey: 'Active', variant: 'success' },
  rejected: { labelKey: 'Rejected', variant: 'danger' },
  suspended: { labelKey: 'Suspended', variant: 'neutral' },
}

export const AGENT_TYPE_LABEL_KEYS = {
  personal: 'Individual',
  company: 'Business',
} as const

export const AGENT_WITHDRAWAL_STATUSES: Record<
  AgentWithdrawalStatus,
  BadgeConfig
> = {
  pending: { labelKey: 'Under Review', variant: 'warning' },
  approved: { labelKey: 'Awaiting Payout', variant: 'info' },
  paid: { labelKey: 'Paid', variant: 'success' },
  rejected: { labelKey: 'Rejected', variant: 'danger' },
  cancelled: { labelKey: 'Cancelled', variant: 'neutral' },
}

export const AGENT_WITHDRAWAL_METHOD_LABEL_KEYS: Record<
  AgentWithdrawalMethod,
  string
> = {
  balance: 'Transfer to Balance',
  bank: 'Bank Transfer',
}

export const AGENT_COMMISSION_STATUSES: Record<
  AgentCommissionStatus,
  BadgeConfig
> = {
  pending: { labelKey: 'Frozen', variant: 'warning' },
  settled: { labelKey: 'Withdrawable', variant: 'success' },
  frozen: { labelKey: 'Reserved for Withdrawal', variant: 'info' },
  paid: { labelKey: 'Settled', variant: 'neutral' },
  reversed: { labelKey: 'Reversed', variant: 'danger' },
}

/** Sentinel meaning "no status filter" in the commission ledger. */
export const AGENT_COMMISSION_STATUS_ALL = 'all'

export const AGENT_COMMISSION_STATUS_FILTERS = [
  AGENT_COMMISSION_STATUS_ALL,
  'pending',
  'settled',
  'frozen',
  'paid',
] as const

/** Statuses an agent may still cancel themselves. */
export const CANCELLABLE_WITHDRAWAL_STATUSES: AgentWithdrawalStatus[] = [
  'pending',
]

// ============================================================================
// Withdrawal Rules
//
// Client-side mirrors of the `AgentMinWithdrawal` / `AgentWithdrawalFeeRate`
// options, used only to pre-validate and preview the fee. The server re-checks
// both, and its rejection is what the user is shown.
// ============================================================================

export const WITHDRAWAL_DEFAULTS = {
  /** RMB. Matches the `AgentMinWithdrawal` default. */
  MIN_AMOUNT: 100,
  /** Matches the `AgentWithdrawalFeeRate` default (platform absorbs the fee). */
  FEE_RATE: 0,
} as const

// ============================================================================
// Validation Constants
// ============================================================================

export const AGENT_PROFILE_VALIDATION = {
  SUBJECT_NAME_MAX_LENGTH: 64,
  ID_NO_MAX_LENGTH: 64,
  COMPANY_NAME_MAX_LENGTH: 255,
  TAX_NO_MAX_LENGTH: 64,
  BANK_NAME_MAX_LENGTH: 255,
  BANK_ACCOUNT_MAX_LENGTH: 64,
  BANK_BRANCH_MAX_LENGTH: 255,
  CONTACT_NAME_MAX_LENGTH: 64,
  CONTACT_PHONE_MAX_LENGTH: 32,
  CONTACT_EMAIL_MAX_LENGTH: 128,
} as const

export const AGENT_CUSTOMERS_PAGE_SIZE = 10
export const AGENT_RECORDS_PAGE_SIZE = 10

// ============================================================================
// Messages (i18n keys; use t(MESSAGES.xxx) when displaying)
// ============================================================================

export const ERROR_MESSAGES = {
  OVERVIEW_FAILED: 'Failed to load your agent workbench',
  CUSTOMERS_FAILED: 'Failed to load your customers',
  COMMISSIONS_FAILED: 'Failed to load the commission ledger',
  WITHDRAWALS_FAILED: 'Failed to load your withdrawal records',
  PROFILE_SAVE_FAILED: 'Failed to save your agent details',
  WITHDRAWAL_FAILED: 'Failed to submit the withdrawal request',
  WITHDRAWAL_CANCEL_FAILED: 'Failed to cancel the withdrawal request',
  EXPORT_FAILED: 'Failed to export the customer list',
  QRCODE_DOWNLOAD_FAILED: 'Failed to download the QR code',
  SUBJECT_NAME_REQUIRED: 'Full name is required',
  ID_NO_REQUIRED: 'ID number is required',
  COMPANY_NAME_REQUIRED: 'Company name is required',
  TAX_NO_REQUIRED: 'Taxpayer identification number is required',
  CONTACT_PHONE_REQUIRED: 'Contact phone is required',
  CONTACT_EMAIL_INVALID: 'Enter a valid email address',
  FIELD_TOO_LONG: 'This value is too long',
  AMOUNT_BELOW_MINIMUM: 'Enter at least {{min}}',
  AMOUNT_ABOVE_AVAILABLE: 'That is more than you can withdraw right now',
  BANK_DETAILS_REQUIRED:
    'Add your bank details before requesting a bank transfer',
} as const

export const SUCCESS_MESSAGES = {
  PROFILE_SAVED: 'Agent details submitted for review',
  WITHDRAWAL_SUBMITTED: 'Withdrawal request submitted',
  WITHDRAWAL_CANCELLED: 'Withdrawal request cancelled',
  EXPORTED: 'Customer list exported',
  QRCODE_DOWNLOADED: 'QR code downloaded',
} as const
