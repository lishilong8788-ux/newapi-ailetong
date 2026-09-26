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
  CostChannelModelRow,
  CostChannelRow,
  CostInventoryRow,
  CostListResponse,
  CostOverview,
  CostTrendPoint,
} from './types'

export interface CostWindow {
  start_timestamp: number
  end_timestamp: number
}

export async function getCostOverview(
  params: CostWindow
): Promise<CostListResponse<CostOverview>> {
  const res = await api.get<CostListResponse<CostOverview>>(
    '/api/cost/overview',
    { params }
  )
  return res.data
}

export async function getCostTrend(
  params: CostWindow
): Promise<CostListResponse<CostTrendPoint[]>> {
  const res = await api.get<CostListResponse<CostTrendPoint[]>>(
    '/api/cost/trend',
    { params }
  )
  return res.data
}

export async function getCostChannels(
  params: CostWindow
): Promise<CostListResponse<CostChannelRow[]>> {
  const res = await api.get<CostListResponse<CostChannelRow[]>>(
    '/api/cost/channels',
    { params }
  )
  return res.data
}

/**
 * Channel × model cross margin for the whole window.
 *
 * The endpoint also takes `model`/`channel_id`, but the view needs the full set
 * to build its model filter — narrowing server-side would cost a second request
 * for the option list and a refetch on every selection, so the focus filter is
 * applied client-side over this one payload (already SQL-aggregated to one row
 * per pair, so it stays small).
 */
export async function getCostChannelModels(
  params: CostWindow
): Promise<CostListResponse<CostChannelModelRow[]>> {
  const res = await api.get<CostListResponse<CostChannelModelRow[]>>(
    '/api/cost/channel-models',
    { params }
  )
  return res.data
}

export async function getCostInventory(): Promise<
  CostListResponse<CostInventoryRow[]>
> {
  const res = await api.get<CostListResponse<CostInventoryRow[]>>(
    '/api/cost/inventory'
  )
  return res.data
}

/**
 * Rebuilds the daily rollup for a window from the `logs` detail (delete then
 * write), returning the server's own count of log rows it read.
 *
 * Root-only server-side. Two properties of the rebuild leak into the UI and are
 * why the caller confirms first: it recomputes with the *current* cost
 * configuration rather than the price in force at the time, and a window whose
 * logs have aged out rebuilds to zero instead of failing.
 */
export async function recalculateCostDaily(
  params: CostWindow
): Promise<{ message: string }> {
  const res = await api.post<{ success: boolean; message: string }>(
    '/api/cost/recalculate',
    params
  )
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Recalculation failed')
  }
  return { message: res.data.message }
}
