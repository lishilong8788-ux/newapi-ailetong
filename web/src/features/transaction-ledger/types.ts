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
/**
 * How trustworthy a row's profit number is.
 *
 * `priced` is the only grade that may be summed. `unpriced` means the upstream
 * cost was never resolved (no buy price configured, or cost accounting is off):
 * the backend stores cost_quota 0 for those, and treating that 0 as a real cost
 * reports 100% margin on a request whose cost is simply unknown. `free` is a
 * zero-revenue request — real, but its margin rate is undefined, not 0%.
 */
export type LedgerGrade = 'priced' | 'unpriced' | 'free'

/**
 * One transaction: a single billable request, flattened from the log row plus
 * its admin-only cost/price snapshots.
 *
 * Quota is the native unit throughout — the same unit `logs.quota` uses — so
 * revenue, cost and profit stay addable without a currency round-trip. Only the
 * cells format it for display.
 */
export interface LedgerRow {
  /** Log row id. Stable within a page; ClickHouse deployments renumber it. */
  id: number
  createdAt: number
  requestId: string
  userId: number
  username: string
  tokenName: string
  /** What the client asked for. */
  modelName: string
  /** What the channel was actually billed for, when it differs. */
  upstreamModelName: string
  channelId: number
  channelName: string
  /** Channel type id; 0 when unknown or the channel was deleted. */
  channelType: number
  /** Public route code of the serving channel, '' when the channel has none. */
  lineCode: string
  promptTokens: number
  completionTokens: number
  /** What the customer paid. */
  revenueQuota: number
  /** What we paid the vendor; null when it could not be resolved. */
  costQuota: number | null
  /** revenue - cost; null whenever cost is null. */
  profitQuota: number | null
  /** profit / revenue; null on unpriced rows and on zero-revenue rows. */
  marginRate: number | null
  grade: LedgerGrade
  costSource: string
  priceSource: string
  /** Configured profit rate, when the buy price priced this request. */
  sellMarkup: number | null
  isStream: boolean
  useTime: number
}

/**
 * Totals for the whole filtered range, summed by the database.
 *
 * GET /api/cost/ledger/summary. Deliberately a separate call from the list: the
 * list is one page, and presenting a page's total as the range's total is the
 * standard way this kind of report gets misread.
 */
export interface LedgerSummary {
  request_count: number
  priced_count: number
  revenue_quota: number
  /** Revenue of priced rows — the denominator the margin rate belongs to. */
  priced_revenue_quota: number
  cost_quota: number
  margin_quota: number
  /** Revenue of rows whose cost could not be resolved. */
  unknown_revenue_quota: number
  /** margin / priced revenue; null when no priced revenue exists. */
  margin_rate: number | null
  /** Share of requests with no resolvable cost; null when the range is empty. */
  unpriced_rate: number | null
}

/** Server-side sort columns. */
export type LedgerSortBy = 'time' | 'profit' | 'cost' | 'revenue'
