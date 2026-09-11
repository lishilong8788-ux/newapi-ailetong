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
  AgentManagementTab,
  AgentStatus,
  AgentType,
  CommissionSourceType,
  CommissionStatus,
  WithdrawalMethod,
  WithdrawalStatus,
} from './types'

type BadgeConfig = Pick<StatusBadgeProps, 'variant'> & { labelKey: string }

// ============================================================================
// Tabs
// ============================================================================

/** Opens on the agent roster; the finance queue is one click away. */
export const AGENT_MANAGEMENT_TAB_DEFAULT: AgentManagementTab = 'agents'

export const AGENT_MANAGEMENT_TAB_LABEL_KEYS: Record<
  AgentManagementTab,
  string
> = {
  agents: 'Agents',
  withdrawals: 'Withdrawal Review',
  commissions: 'Commission Ledger',
}

// ============================================================================
// Status filters
// ============================================================================

/** Sentinel filter value meaning "no status filter". */
export const AGENT_STATUS_FILTER_ALL = 'all'

// labelKey values are i18n keys; render with t(config.labelKey)
export const AGENT_STATUSES: Record<AgentStatus, BadgeConfig> = {
  incomplete: { labelKey: 'Incomplete', variant: 'neutral' },
  pending: { labelKey: 'Pending Review', variant: 'warning' },
  active: { labelKey: 'Active', variant: 'success' },
  rejected: { labelKey: 'Rejected', variant: 'danger' },
  suspended: { labelKey: 'Suspended', variant: 'danger' },
}

export const AGENT_TYPE_LABEL_KEYS: Record<AgentType, string> = {
  personal: 'Personal',
  company: 'Company',
}

export const WITHDRAWAL_STATUSES: Record<WithdrawalStatus, BadgeConfig> = {
  pending: { labelKey: 'Pending Review', variant: 'warning' },
  approved: { labelKey: 'Awaiting Payment', variant: 'info' },
  paid: { labelKey: 'Paid', variant: 'success' },
  rejected: { labelKey: 'Rejected', variant: 'danger' },
}

export const WITHDRAWAL_METHOD_LABEL_KEYS: Record<WithdrawalMethod, string> = {
  balance: 'Platform Balance',
  bank: 'Bank Transfer',
}

export const COMMISSION_STATUSES: Record<CommissionStatus, BadgeConfig> = {
  pending: { labelKey: 'Frozen', variant: 'neutral' },
  settled: { labelKey: 'Withdrawable', variant: 'success' },
  frozen: { labelKey: 'Held By Withdrawal', variant: 'info' },
  paid: { labelKey: 'Settled', variant: 'success' },
  reversed: { labelKey: 'Reversed', variant: 'danger' },
}

export const COMMISSION_SOURCE_TYPE_LABEL_KEYS: Record<
  CommissionSourceType,
  string
> = {
  topup: 'Top-up',
  subscription: 'Subscription',
  manual: 'Manual Adjustment',
}

export function getAgentStatusOptions(t: (key: string) => string) {
  return (Object.keys(AGENT_STATUSES) as AgentStatus[]).map((status) => ({
    label: t(AGENT_STATUSES[status].labelKey),
    value: status,
  }))
}

export function getAgentTypeOptions(t: (key: string) => string) {
  return (Object.keys(AGENT_TYPE_LABEL_KEYS) as AgentType[]).map((type) => ({
    label: t(AGENT_TYPE_LABEL_KEYS[type]),
    value: type,
  }))
}

export function getWithdrawalStatusOptions(t: (key: string) => string) {
  return (Object.keys(WITHDRAWAL_STATUSES) as WithdrawalStatus[]).map(
    (status) => ({
      label: t(WITHDRAWAL_STATUSES[status].labelKey),
      value: status,
    })
  )
}

export function getWithdrawalMethodOptions(t: (key: string) => string) {
  return (Object.keys(WITHDRAWAL_METHOD_LABEL_KEYS) as WithdrawalMethod[]).map(
    (method) => ({
      label: t(WITHDRAWAL_METHOD_LABEL_KEYS[method]),
      value: method,
    })
  )
}

export function getCommissionStatusOptions(t: (key: string) => string) {
  return (Object.keys(COMMISSION_STATUSES) as CommissionStatus[]).map(
    (status) => ({
      label: t(COMMISSION_STATUSES[status].labelKey),
      value: status,
    })
  )
}

export function getCommissionSourceTypeOptions(t: (key: string) => string) {
  return (
    Object.keys(COMMISSION_SOURCE_TYPE_LABEL_KEYS) as CommissionSourceType[]
  ).map((sourceType) => ({
    label: t(COMMISSION_SOURCE_TYPE_LABEL_KEYS[sourceType]),
    value: sourceType,
  }))
}

// ============================================================================
// Validation Constants
// ============================================================================

export const AGENT_VALIDATION = {
  REASON_MIN_LENGTH: 5,
  REASON_MAX_LENGTH: 500,
  VOUCHER_MIN_LENGTH: 4,
  VOUCHER_MAX_LENGTH: 255,
  /**
   * Client-side ceiling only. The server owns `AgentMaxRate`; this stops an
   * obvious typo (5 instead of 0.05) from ever leaving the browser.
   */
  RATE_MAX: 1,
  RATE_MIN: 0,
  /** Manual ledger adjustments are bounded so a stray zero cannot land a credit. */
  ADJUST_AMOUNT_MAX: 1_000_000,
} as const

// ============================================================================
// Messages (i18n keys; render with t(MESSAGES.xxx))
// ============================================================================

export const ERROR_MESSAGES = {
  LOAD_AGENTS_FAILED: 'Failed to load agents',
  LOAD_AGENT_DETAIL_FAILED: 'Failed to load agent detail',
  LOAD_WITHDRAWALS_FAILED: 'Failed to load withdrawal requests',
  LOAD_WITHDRAWAL_DETAIL_FAILED: 'Failed to load withdrawal detail',
  LOAD_COMMISSIONS_FAILED: 'Failed to load the commission ledger',
  AUDIT_AGENT_FAILED: 'Failed to review the agent',
  SET_RATE_FAILED: 'Failed to update the commission rate',
  SET_STATUS_FAILED: 'Failed to update the agent status',
  APPROVE_WITHDRAWAL_FAILED: 'Failed to approve the withdrawal',
  REJECT_WITHDRAWAL_FAILED: 'Failed to reject the withdrawal',
  COMPLETE_WITHDRAWAL_FAILED: 'Failed to mark the withdrawal as paid',
  FAIL_WITHDRAWAL_FAILED: 'Failed to mark the payout as failed',
  ADJUST_COMMISSION_FAILED: 'Failed to record the commission adjustment',
  EXPORT_FAILED: 'Failed to export the data',
  REASON_TOO_SHORT: 'Reason must be at least {{min}} characters long',
  REASON_TOO_LONG: 'Reason must be at most {{max}} characters',
  VOUCHER_REQUIRED: 'Payment voucher number is required',
  VOUCHER_TOO_LONG: 'Payment voucher must be at most {{max}} characters',
  RATE_REQUIRED: 'Commission rate is required',
  RATE_OUT_OF_RANGE: 'Commission rate must be between {{min}} and {{max}}',
  AMOUNT_REQUIRED: 'Amount is required',
  AMOUNT_NOT_ZERO: 'Amount cannot be zero',
  AMOUNT_OUT_OF_RANGE: 'Amount must be between -{{max}} and {{max}}',
  AGENT_REQUIRED: 'Agent user ID is required',
} as const

export const SUCCESS_MESSAGES = {
  AGENT_APPROVED: 'Agent approved',
  AGENT_REJECTED: 'Agent application rejected',
  RATE_UPDATED: 'Commission rate updated',
  STATUS_UPDATED: 'Agent status updated',
  WITHDRAWAL_APPROVED: 'Withdrawal approved',
  WITHDRAWAL_REJECTED: 'Withdrawal rejected',
  WITHDRAWAL_COMPLETED: 'Withdrawal marked as paid',
  WITHDRAWAL_FAILED: 'Payout marked as failed',
  COMMISSION_ADJUSTED: 'Commission adjustment recorded',
  EXPORTED: 'Export ready',
} as const
