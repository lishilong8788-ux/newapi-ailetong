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
// API contract — /api/cost/*
// ============================================================================

/** GET /api/cost/overview */
export interface CostOverview {
  start_ts: number
  end_ts: number
  revenue_quota: number
  cost_quota: number
  margin_quota: number
  /** (revenue-cost)/revenue; null when revenue is 0 (free models) — render "—" */
  margin_rate: number | null
  unknown_quota: number
  /** unknown request share; null when no requests */
  unknown_rate: number | null
  request_count: number
}

/** One day bucket from GET /api/cost/trend. */
export interface CostTrendPoint {
  day_ts: number
  /**
   * Server-local calendar day of this bucket, `YYYY-MM-DD`.
   *
   * Rendering `day_ts` here instead would label the bucket in the *browser's*
   * timezone, which is only the same day when the viewer happens to share the
   * server's offset — `day_ts` is local midnight on the server, so a UTC+8
   * server's 09-23 bucket reads as 09-22 16:00 to a UTC viewer. Which day a
   * bucket belongs to is a server fact, so the server states it.
   */
  day?: string
  request_count: number
  token_used: number
  revenue_quota: number
  cost_quota: number
  unknown_count: number
  unknown_quota: number
}

/** GET /api/cost/channels row (aggregated per channel). */
export interface CostChannelRow {
  channel_id: number
  channel_name: string
  request_count: number
  token_used: number
  revenue_quota: number
  cost_quota: number
  unknown_count: number
  unknown_quota: number
  margin_rate: number | null
}

/** GET /api/cost/channel/:id row (per upstream model). */
export interface CostModelRow {
  channel_id: number
  model_name: string
  day_ts: number
  request_count: number
  token_used: number
  revenue_quota: number
  cost_quota: number
  unknown_count: number
  unknown_quota: number
  margin_rate: number | null
}

/**
 * GET /api/cost/channel-models row — one (channel, model) pair.
 *
 * `day_ts` is always 0: the endpoint groups the whole window in SQL, so the day
 * dimension is already collapsed and only the channel × model cross survives.
 */
export interface CostChannelModelRow {
  channel_id: number
  /** `#<id> (deleted)` when the channel is gone but its ledger rows remain. */
  channel_name: string
  model_name: string
  day_ts: number
  request_count: number
  token_used: number
  revenue_quota: number
  cost_quota: number
  unknown_count: number
  unknown_quota: number
  reported_quota: number
  /** Priced revenue − cost. Negative means this channel loses money. */
  margin_quota: number
  /** margin/priced revenue; null when nothing on this row is priced. */
  margin_rate: number | null
  /** Unpriced share of requests; null when the row has no requests. */
  unknown_rate: number | null
}

/** GET /api/cost/inventory row. */
export interface CostInventoryRow {
  channel_id: number
  channel_name: string
  fetched_balance: number
  has_fetched: boolean
  purchased_usd: number
  spent_usd: number
  derived_balance: number
  diff_rate: number | null
}

export interface CostListResponse<T> {
  success: boolean
  message?: string
  data?: T
}

/** One purchase record. */
export interface ChannelPurchase {
  id: number
  channel_id: number
  purchased_at: number
  amount_usd: number
  amount_local: number
  exchange_rate: number
  bonus_usd: number
  vendor: string
  order_no: string
  note: string
  operator_id: number
  created_at: number
}
