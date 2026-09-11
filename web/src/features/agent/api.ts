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
  AgentCommission,
  AgentCustomer,
  AgentOverview,
  AgentProfilePayload,
  AgentWithdrawal,
  ApiResponse,
  CreateWithdrawalPayload,
  ListAgentCommissionsParams,
  ListAgentCustomersParams,
  ListAgentWithdrawalsParams,
  PaginatedItems,
} from './types'

// ============================================================================
// Profile & Earnings
// ============================================================================

export async function getAgentOverview(): Promise<ApiResponse<AgentOverview>> {
  const res = await api.get('/api/agent/profile')
  return res.data
}

export async function saveAgentProfile(
  payload: AgentProfilePayload
): Promise<ApiResponse> {
  const res = await api.post('/api/agent/profile', payload)
  return res.data
}

// ============================================================================
// Customers
// ============================================================================

export async function listAgentCustomers(
  params: ListAgentCustomersParams = {}
): Promise<ApiResponse<PaginatedItems<AgentCustomer>>> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  query.set('keyword', params.keyword ?? '')
  const res = await api.get(`/api/agent/customers?${query.toString()}`)
  return res.data
}

/**
 * Streams the customer list as CSV. Returned as a Blob so the caller can hand
 * it straight to a download anchor.
 */
export async function exportAgentCustomers(): Promise<Blob> {
  const res = await api.get('/api/agent/customers/export', {
    responseType: 'blob',
    skipBusinessError: true,
  })
  return res.data as Blob
}

// ============================================================================
// Commission Ledger
// ============================================================================

export async function listAgentCommissions(
  params: ListAgentCommissionsParams = {}
): Promise<ApiResponse<PaginatedItems<AgentCommission>>> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  query.set('status', params.status ?? '')
  const res = await api.get(`/api/agent/commissions?${query.toString()}`)
  return res.data
}

// ============================================================================
// Withdrawals
// ============================================================================

export async function createAgentWithdrawal(
  payload: CreateWithdrawalPayload
): Promise<ApiResponse> {
  const res = await api.post('/api/agent/withdrawal', payload)
  return res.data
}

export async function listAgentWithdrawals(
  params: ListAgentWithdrawalsParams = {}
): Promise<ApiResponse<PaginatedItems<AgentWithdrawal>>> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  const res = await api.get(`/api/agent/withdrawals?${query.toString()}`)
  return res.data
}

export async function cancelAgentWithdrawal(id: number): Promise<ApiResponse> {
  const res = await api.post(`/api/agent/withdrawals/${id}/cancel`)
  return res.data
}
