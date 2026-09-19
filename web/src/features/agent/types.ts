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
 * Review is the gate on *being* an agent, not just on cashing out: a promo link
 * is issued and commission accrues only once the review has passed, so `active`
 * is the single earning state and `suspended` an operator's stop on one.
 *
 * The pre-approval states are all pre-promotion — `pending` and `rejected` come
 * from the applicant's own submission, `incomplete` only from an operator adding
 * someone in the admin console before they have filled anything in.
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
  /**
   * When the first review passed. `0` means never approved.
   *
   * Never cleared, so it stays true through a later re-review — the server uses
   * it, not `status`, to decide whether commission keeps accruing.
   */
  approved_at: number
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
 * Withdrawal rules, mirroring the `AgentMinWithdrawal` /
 * `AgentWithdrawalFeeRate` options. The server remains the authority on all
 * three, so the dialog pre-validates against them but surfaces the server's
 * rejection rather than reimplementing it.
 */
export interface AgentWithdrawalRules {
  /** RMB. */
  min_amount: number
  fee_rate: number
  can_apply: boolean
}

/** Programme terms, shown on the application page before there is a profile. */
export interface AgentProgramme {
  default_rate: number
  freeze_days: number
  auto_approve: boolean
}

/**
 * Everything the referral page needs on first paint: who the agent is, what they
 * have earned, and — once review has passed — the link they hand out.
 *
 * `profile` is `null` for anyone who has never applied; nothing is written on a
 * mere page visit. `aff_code` / `promo_link` / `register_link` are absent until
 * the profile reaches `active` or `suspended`, so promotion material simply does
 * not exist client-side before approval.
 */
export interface AgentOverview {
  profile: AgentProfile | null
  effective_rate: number
  stats: AgentStats
  aff_code?: string
  promo_link?: string
  register_link?: string
  withdrawal: AgentWithdrawalRules
  programme: AgentProgramme
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
