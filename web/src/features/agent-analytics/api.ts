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

import type { AgentAnalyticsQuery, AgentAnalyticsResponse } from './types'

/**
 * Aggregated distribution analytics for one bounded window.
 *
 * The window is always sent explicitly: the endpoint aggregates over
 * `agent_commission`, and an unbounded request would scan the full ledger
 * (design doc 11.5).
 */
export async function getAgentAnalytics(
  params: AgentAnalyticsQuery
): Promise<AgentAnalyticsResponse> {
  const res = await api.get<AgentAnalyticsResponse>(
    '/api/agent/admin/analytics',
    { params }
  )
  return res.data
}

/**
 * Commission ledger as CSV, for an operator who needs the underlying rows rather
 * than the per-agent rollup this page shows.
 *
 * Returned as a Blob so the caller can hand it straight to a download anchor.
 * `skipBusinessError` because the response body is a file, not the usual
 * `{ success, message }` envelope the interceptor expects.
 */
export async function exportAgentCommissions(): Promise<Blob> {
  const res = await api.get('/api/agent/admin/export', {
    params: { type: 'commissions' },
    responseType: 'blob',
    skipBusinessError: true,
  })
  return res.data as Blob
}
