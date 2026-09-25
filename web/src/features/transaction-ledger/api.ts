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
import type { UsageLog } from '@/features/usage-logs/data/schema'
import { api } from '@/lib/api'

import type { ProfitFilterValue } from './constants'
import type { LedgerSortBy, LedgerSummary } from './types'

export interface LedgerQuery {
  page: number
  pageSize: number
  startTimestamp: number
  endTimestamp: number
  /** Exact username, or '' for all. Supports the backend's % wildcard. */
  username?: string
  modelName?: string
  /** Channel id, or undefined for all. */
  channel?: number
  group?: string
  lineCode?: string
  margin?: ProfitFilterValue
  sortBy?: LedgerSortBy
  sortAsc?: boolean
}

export interface LedgerPage {
  items: UsageLog[]
  total: number
}

function buildParams(query: LedgerQuery): URLSearchParams {
  const params = new URLSearchParams({
    p: String(query.page),
    page_size: String(query.pageSize),
    start_timestamp: String(query.startTimestamp),
    end_timestamp: String(query.endTimestamp),
  })
  if (query.username) params.set('username', query.username)
  if (query.modelName) params.set('model_name', query.modelName)
  if (query.channel) params.set('channel', String(query.channel))
  if (query.group) params.set('group', query.group)
  if (query.lineCode) params.set('line_code', query.lineCode)
  // 'all' is the absence of a filter, so it is left off the query string
  // entirely rather than sent as a value the backend has to recognise.
  if (query.margin && query.margin !== 'all') params.set('margin', query.margin)
  if (query.sortBy && query.sortBy !== 'time') params.set('sort_by', query.sortBy)
  if (query.sortAsc) params.set('order', 'asc')
  return params
}

/**
 * Fetches one page of transactions.
 *
 * Hits the ledger endpoint rather than the general log list: sorting by profit
 * and filtering to loss-making requests are SQL over the denormalized margin
 * columns, which the log endpoint neither exposes nor orders by.
 */
export async function getLedgerPage(query: LedgerQuery): Promise<LedgerPage> {
  const res = await api.get(`/api/cost/ledger?${buildParams(query)}`)
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Failed to load transaction ledger')
  }
  return {
    items: (res.data.data?.items ?? []) as UsageLog[],
    total: res.data.data?.total ?? 0,
  }
}

/**
 * Fetches totals for the whole filtered range.
 *
 * Separate from the page so the summary describes the range the reader filtered,
 * not the twenty rows they happen to be looking at.
 */
export async function getLedgerSummary(
  query: LedgerQuery
): Promise<LedgerSummary> {
  const res = await api.get(`/api/cost/ledger/summary?${buildParams(query)}`)
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Failed to load ledger summary')
  }
  return res.data.data as LedgerSummary
}

/**
 * Backfills the margin columns from historical log snapshots.
 *
 * Idempotent — it only touches rows with no cost grade yet — so a long history
 * can be walked in several calls.
 */
export async function backfillLedger(params: {
  startTimestamp?: number
  endTimestamp?: number
  limit?: number
}): Promise<{ scanned: number; updated: number }> {
  const search = new URLSearchParams()
  if (params.startTimestamp) {
    search.set('start_timestamp', String(params.startTimestamp))
  }
  if (params.endTimestamp) {
    search.set('end_timestamp', String(params.endTimestamp))
  }
  if (params.limit) search.set('limit', String(params.limit))

  const res = await api.post(`/api/cost/ledger/backfill?${search}`)
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Backfill failed')
  }
  return res.data.data
}
