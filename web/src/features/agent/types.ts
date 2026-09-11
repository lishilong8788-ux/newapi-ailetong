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

// ============================================================================
// Domain Types
// ============================================================================

export type AgentType = 'personal' | 'company'

/**
 * Only `active` may withdraw. The other states can still promote and accrue
 * commission — identity review is a gate on cashing out, not on earning.
 */
export type AgentStatus =
  | 'incomplete'
  | 'pending'
  | 'active'
  | 'rejected'
  | 'suspended'

export type AgentWithdrawalMethod = 'balance' | 'bank'

export type AgentWithdrawalStatus =
  | 'pending'
  | 'approved'
  | 'paid'
  | 'rejected'
  | 'cancelled'

export type AgentCommissionStatus =
  | 'pending'
  | 'settled'
  | 'frozen'
  | 'paid'
  | 'reversed'

/**
 * The agent's own view of their profile.
 *
 * `bank_account` arrives masked (last four digits only) — the server never
 * sends the full number to the agent-facing endpoint, so the UI must not
 * present it as editable-in-place.
 */
export interface AgentProfile {
  id: number
  user_id: number
  agent_type: AgentType
  status: AgentStatus
  /** Free-form operator label, display only. */
  level: string
  /** `null` means "follows the platform default". */
  commission_rate: number | null
  subject_name: string
  id_no: string
  company_name: string
  tax_no: string
  bank_name: string
  /** Masked: last four digits only. */
  bank_account: string
  bank_branch: string
  contact_name: string
  contact_phone: string
  contact_email: string
  reject_reason: string
  created_at: number
  updated_at: number
}

/** Money figures are RMB decimals; `customer_count` is a plain count. */
export interface AgentStats {
  available: number
  total: number
  withdrawn: number
  customer_count: number
}

/**
 * A downstream customer. Deliberately narrow: email, phone, API keys and
 * request logs are never exposed to an agent (design doc §13.2).
 */
export interface AgentCustomer {
  id: number
  username: string
  display_name: string
  created_at: number
  /** Remaining quota, in quota units. */
  quota: number
  /** Lifetime usage, in quota units. */
  used_quota: number
  /** Backend user status: 1 enabled, 2 disabled. */
  status: number
  /** Lifetime topup that produced commission, RMB. */
  topup_total: number
  /** Lifetime commission earned from this customer, RMB. */
  commission_total: number
}

export interface AgentCommission {
  id: number
  from_user_id: number
  from_username: string
  source_type: string
  source_id: number
  base_amount: number
  rate: number
  amount: number
  status: AgentCommissionStatus
  available_time: number
  create_time: number
  remark: string
}

export interface AgentWithdrawal {
  id: number
  amount: number
  fee: number
  actual_amount: number
  method: AgentWithdrawalMethod
  status: AgentWithdrawalStatus
  pay_voucher: string
  reject_reason: string
  create_time: number
  audit_time: number
  pay_time: number
}

export interface AgentStatsPoint {
  date: string
  new_customers: number
  topup_amount: number
  commission: number
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

/**
 * Everything the workbench needs on first paint: who the agent is, what they
 * have earned, and the link they hand out.
 *
 * `min_withdrawal` and `withdrawal_fee_rate` mirror the `AgentMinWithdrawal` /
 * `AgentWithdrawalFeeRate` options. They are optional because the client can
 * fall back to the documented defaults; the server remains the authority on
 * both, so the dialog surfaces its rejection rather than trusting these.
 */
export interface AgentOverview {
  profile: AgentProfile
  stats: AgentStats
  promo_link: string
  aff_code: string
  min_withdrawal?: number
  withdrawal_fee_rate?: number
}

export interface AgentProfilePayload {
  agent_type: AgentType
  subject_name: string
  id_no: string
  company_name: string
  tax_no: string
  bank_name: string
  bank_account: string
  bank_branch: string
  contact_name: string
  contact_phone: string
  contact_email: string
}

export interface ListAgentCustomersParams {
  p?: number
  page_size?: number
  keyword?: string
}

export interface ListAgentCommissionsParams {
  p?: number
  page_size?: number
  status?: string
}

export interface ListAgentWithdrawalsParams {
  p?: number
  page_size?: number
}

export interface PaginatedItems<T> {
  items: T[]
  total: number
}

export interface CreateWithdrawalPayload {
  amount: number
  method: AgentWithdrawalMethod
}

// ============================================================================
// Dialog Types
// ============================================================================

export type AgentDialogType =
  | 'profile'
  | 'withdrawal'
  | 'withdrawals'
  | 'commissions'
