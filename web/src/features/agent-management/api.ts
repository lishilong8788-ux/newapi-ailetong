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
import { api } from '@/lib/api'

import type {
  AdjustCommissionPayload,
  AgentDetail,
  AgentExportType,
  ApiResponse,
  AuditAgentPayload,
  CompleteWithdrawalPayload,
  ListAgentsParams,
  ListAgentsResponse,
  ListCommissionsParams,
  ListCommissionsResponse,
  ListWithdrawalsParams,
  ListWithdrawalsResponse,
  RejectWithdrawalPayload,
  SetAgentRatePayload,
  SetAgentStatusPayload,
  WithdrawalDetail,
} from './types'

// ============================================================================
// Agents (admin)
// ============================================================================

export async function listAgentProfiles(
  params: ListAgentsParams = {}
): Promise<ListAgentsResponse> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  query.set('status', params.status ?? '')
  query.set('keyword', params.keyword ?? '')
  const res = await api.get(`/api/agent/admin/profiles?${query.toString()}`)
  return res.data
}

export async function getAgentProfile(
  id: number
): Promise<ApiResponse<AgentDetail>> {
  const res = await api.get(`/api/agent/admin/profiles/${id}`)
  return res.data
}

export async function auditAgentProfile(
  id: number,
  payload: AuditAgentPayload
): Promise<ApiResponse> {
  const res = await api.post(`/api/agent/admin/profiles/${id}/audit`, payload)
  return res.data
}

export async function setAgentCommissionRate(
  id: number,
  payload: SetAgentRatePayload
): Promise<ApiResponse> {
  const res = await api.post(`/api/agent/admin/profiles/${id}/rate`, payload)
  return res.data
}

export async function setAgentStatus(
  id: number,
  payload: SetAgentStatusPayload
): Promise<ApiResponse> {
  const res = await api.post(`/api/agent/admin/profiles/${id}/status`, payload)
  return res.data
}

export async function createAgentProfile(userId: number): Promise<ApiResponse> {
  const res = await api.post('/api/agent/admin/profiles', { user_id: userId })
  return res.data
}

// ============================================================================
// Withdrawals (admin)
// ============================================================================

export async function listWithdrawals(
  params: ListWithdrawalsParams = {}
): Promise<ListWithdrawalsResponse> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  query.set('status', params.status ?? '')
  query.set('method', params.method ?? '')
  const res = await api.get(`/api/agent/admin/withdrawals?${query.toString()}`)
  return res.data
}

export async function getWithdrawal(
  id: number
): Promise<ApiResponse<WithdrawalDetail>> {
  const res = await api.get(`/api/agent/admin/withdrawals/${id}`)
  return res.data
}

export async function approveWithdrawal(id: number): Promise<ApiResponse> {
  const res = await api.post(`/api/agent/admin/withdrawals/${id}/approve`)
  return res.data
}

export async function rejectWithdrawal(
  id: number,
  payload: RejectWithdrawalPayload
): Promise<ApiResponse> {
  const res = await api.post(
    `/api/agent/admin/withdrawals/${id}/reject`,
    payload
  )
  return res.data
}

export async function completeWithdrawal(
  id: number,
  payload: CompleteWithdrawalPayload
): Promise<ApiResponse> {
  const res = await api.post(
    `/api/agent/admin/withdrawals/${id}/complete`,
    payload
  )
  return res.data
}

export async function failWithdrawal(
  id: number,
  payload: RejectWithdrawalPayload
): Promise<ApiResponse> {
  const res = await api.post(`/api/agent/admin/withdrawals/${id}/fail`, payload)
  return res.data
}

// ============================================================================
// Commission ledger (admin)
// ============================================================================

export async function listCommissions(
  params: ListCommissionsParams = {}
): Promise<ListCommissionsResponse> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  if (params.agent_user_id) {
    query.set('agent_user_id', String(params.agent_user_id))
  }
  if (params.from_user_id) {
    query.set('from_user_id', String(params.from_user_id))
  }
  query.set('status', params.status ?? '')
  query.set('source_type', params.source_type ?? '')
  if (params.start_time) query.set('start_time', String(params.start_time))
  if (params.end_time) query.set('end_time', String(params.end_time))
  if (params.min_amount !== undefined) {
    query.set('min_amount', String(params.min_amount))
  }
  if (params.max_amount !== undefined) {
    query.set('max_amount', String(params.max_amount))
  }
  const res = await api.get(`/api/agent/admin/commissions?${query.toString()}`)
  return res.data
}

/**
 * Records a manual adjustment. The ledger is append-only, so this always
 * inserts a new (possibly negative) row rather than editing history.
 */
export async function adjustCommission(
  payload: AdjustCommissionPayload
): Promise<ApiResponse> {
  const res = await api.post('/api/agent/admin/commissions/adjust', payload)
  return res.data
}

/**
 * Streams one of the admin worksheets as CSV. Returned as a Blob so the caller
 * can hand it straight to a download anchor. Bank accounts are masked in the
 * server-rendered file.
 */
export async function exportAgentData(type: AgentExportType): Promise<Blob> {
  const res = await api.get(`/api/agent/admin/export?type=${type}`, {
    responseType: 'blob',
    skipBusinessError: true,
  })
  return res.data as Blob
}
