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

export async function getCostInventory(): Promise<
  CostListResponse<CostInventoryRow[]>
> {
  const res = await api.get<CostListResponse<CostInventoryRow[]>>(
    '/api/cost/inventory'
  )
  return res.data
}
