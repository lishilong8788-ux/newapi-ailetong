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

export type AgentStatus =
  | 'incomplete'
  | 'pending'
  | 'active'
  | 'rejected'
  | 'suspended'

export type WithdrawalMethod = 'balance' | 'bank'

export type WithdrawalStatus = 'pending' | 'approved' | 'paid' | 'rejected'

export type CommissionStatus =
  | 'pending'
  | 'settled'
  | 'frozen'
  | 'paid'
  | 'reversed'

export type CommissionSourceType = 'topup' | 'subscription' | 'manual'

/**
 * Agent subject record. Money fields are RMB decimals, never quota — they must
 * not be routed through `formatQuota`.
 */
export interface AgentProfile {
  id: number
  user_id: number
  agent_type: AgentType
  status: AgentStatus
  level: string
  /** `null` means "follow the global default rate" rather than "zero commission". */
  commission_rate: number | null
  subject_name: string
  id_no: string
  company_name: string
  tax_no: string
  bank_name: string
  /**
   * Masked on the list and on exports; only the withdrawal detail endpoint
   * returns the full number. Treat it as possibly-masked everywhere else.
   */
  bank_account: string
  bank_branch: string
  contact_name: string
  contact_phone: string
  contact_email: string
  audit_by: number
  audit_time: number
  reject_reason: string
  remark: string
  created_at: number
  updated_at: number
}

/** List row: the profile plus the joined display and roll-up columns. */
export interface AgentListItem extends AgentProfile {
  username: string
  display_name: string
  customer_count: number
  agent_commission_total: number
  agent_commission_available: number
  agent_withdrawn_total: number
}

/**
 * Aggregates behind the detail sheet. Every field is optional: the roll-ups are
 * computed server-side and a partial payload must degrade to a dash, not to NaN.
 */
export interface AgentStats {
  customer_count?: number
  paid_customer_count?: number
  commission_total?: number
  commission_available?: number
  commission_frozen?: number
  withdrawn_total?: number
  topup_total?: number
  first_commission_time?: number
  last_commission_time?: number
}

export interface AgentWithdrawal {
  id: number
  agent_user_id: number
  username: string
  display_name: string
  amount: number
  fee: number
  actual_amount: number
  method: WithdrawalMethod
  status: WithdrawalStatus
  pay_voucher: string
  reject_reason: string
  create_time: number
  audit_time: number
  pay_time: number
  audit_by: number
}

/**
 * One ledger line. The ledger is append-only: an adjustment adds a row, it never
 * rewrites one, so `amount` may be negative.
 */
export interface AgentCommission {
  id: number
  agent_user_id: number
  username?: string
  display_name?: string
  from_user_id: number
  from_username?: string
  source_type: CommissionSourceType
  source_id: number
  base_amount: number
  rate: number
  amount: number
  status: CommissionStatus
  available_time?: number
  withdrawal_id?: number
  remark: string
  create_time: number
}

/** The commission rows a withdrawal claimed, as returned by its detail endpoint. */
export interface WithdrawalCommissionLine {
  id: number
  from_user_id: number
  from_username: string
  source_type: CommissionSourceType
  source_id: number
  base_amount: number
  rate: number
  amount: number
  create_time: number
}

/** Subject snapshot taken when the withdrawal was submitted. */
export interface WithdrawalProfileSnapshot {
  agent_type?: AgentType
  subject_name?: string
  company_name?: string
  tax_no?: string
  bank_name?: string
  /** Unmasked here, and only here: finance needs it to pay. */
  bank_account?: string
  bank_branch?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface ListAgentsParams {
  p?: number
  page_size?: number
  status?: string
  keyword?: string
}

export interface ListAgentsResponse {
  success: boolean
  message?: string
  data?: {
    items: AgentListItem[]
    total: number
  }
}

export interface AgentDetail {
  profile: AgentProfile
  stats: AgentStats
}

export interface AuditAgentPayload {
  approve: boolean
  reason?: string
}

export interface SetAgentRatePayload {
  /** `null` clears the override and falls back to the global default. */
  rate: number | null
}

export interface SetAgentStatusPayload {
  status: Extract<AgentStatus, 'active' | 'suspended'>
}

export interface ListWithdrawalsParams {
  p?: number
  page_size?: number
  status?: string
  method?: string
}

export interface ListWithdrawalsResponse {
  success: boolean
  message?: string
  data?: {
    items: AgentWithdrawal[]
    total: number
    counts?: {
      pending: number
      approved: number
    }
  }
}

export interface WithdrawalDetail {
  withdrawal: AgentWithdrawal
  profile_snapshot: WithdrawalProfileSnapshot
  commissions: WithdrawalCommissionLine[]
}

export interface RejectWithdrawalPayload {
  reason: string
}

export interface CompleteWithdrawalPayload {
  voucher: string
}

export interface ListCommissionsParams {
  p?: number
  page_size?: number
  agent_user_id?: number
  from_user_id?: number
  status?: string
  source_type?: string
  start_time?: number
  end_time?: number
  min_amount?: number
  max_amount?: number
}

export interface ListCommissionsResponse {
  success: boolean
  message?: string
  data?: {
    items: AgentCommission[]
    total: number
  }
}

export interface AdjustCommissionPayload {
  agent_user_id: number
  amount: number
  reason: string
}

export type AgentExportType = 'agents' | 'withdrawals' | 'commissions'

// ============================================================================
// Page / Dialog Types
// ============================================================================

export const AGENT_MANAGEMENT_TABS = [
  'agents',
  'withdrawals',
  'commissions',
] as const

export type AgentManagementTab = (typeof AGENT_MANAGEMENT_TABS)[number]

export type AgentsDialogType =
  | 'agent-detail'
  | 'agent-audit'
  | 'agent-rate'
  | 'agent-status'
  | 'agent-batch-approve'
  | 'agent-batch-rate'
  | 'withdrawal-detail'
  | 'withdrawal-approve'
  | 'withdrawal-reject'
  | 'withdrawal-complete'
  | 'withdrawal-fail'
  | 'commission-adjust'
