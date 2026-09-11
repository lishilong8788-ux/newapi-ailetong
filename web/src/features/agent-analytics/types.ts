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

/** Bucket width for the trend series. Not `@/lib/time`'s TimeGranularity: this
 * page aggregates by calendar day/week/month, never by hour. */
export type AgentAnalyticsGranularity = 'day' | 'week' | 'month'

// ============================================================================
// API contract — GET /api/agent/admin/analytics
// ============================================================================

export interface AgentAnalyticsQuery {
  start_time: number
  end_time: number
  granularity: AgentAnalyticsGranularity
}

/**
 * Platform-wide totals for the requested window.
 *
 * Currency fields are RMB decimals (yuan), not quota units. Rate fields are
 * fractions in [0, 1] — render them as percentages, never multiply twice.
 */
export interface AgentAnalyticsOverview {
  total_agents: number
  active_agents: number
  promoted_customers: number
  paying_customers: number
  /** paying_customers / promoted_customers */
  paying_rate: number
  promoted_revenue: number
  commission_paid: number
  /** commission_paid / promoted_revenue — the true blended cost of the channel */
  effective_rate: number
  pending_payout: number
}

/** One pre-aggregated bucket. `date` is `YYYY-MM-DD` (the bucket's first day). */
export interface AgentAnalyticsTrendPoint {
  date: string
  new_customers: number
  paying_customers: number
  revenue: number
  commission: number
}

/** One agent's aggregate over the window. Timestamps are Unix seconds; `0`
 * means "never" (an agent that has not earned a commission yet). */
export interface AgentAnalyticsRow {
  agent_user_id: number
  username: string
  display_name: string
  customer_count: number
  paying_customer_count: number
  paying_rate: number
  revenue: number
  avg_revenue_per_customer: number
  commission: number
  effective_rate: number
  first_commission_time: number
  last_commission_time: number
  /** Commission count in the trailing 30 days — the activity signal. */
  active_30d: number
}

export interface AgentAnalyticsData {
  overview: AgentAnalyticsOverview
  trend: AgentAnalyticsTrendPoint[]
  agents: AgentAnalyticsRow[]
}

export interface AgentAnalyticsResponse {
  success: boolean
  message?: string
  data?: AgentAnalyticsData
}

// ============================================================================
// Derived view models (see lib/analytics.ts)
// ============================================================================

/** A trend bucket plus the per-bucket effective rate, ready for a chart. */
export interface AgentTrendBucket {
  /** `YYYY-MM-DD` for day, ISO week Monday for week, `YYYY-MM` for month. */
  key: string
  new_customers: number
  paying_customers: number
  revenue: number
  commission: number
  effective_rate: number
}

export type AgentRankingMetric =
  | 'revenue'
  | 'commission'
  | 'customers'
  | 'paying_rate'

export interface AgentRankingEntry {
  agent_user_id: number
  label: string
  value: number
}

/**
 * Where an agent sits relative to the cohort medians. This is the judgement the
 * page exists to make: `high_volume_low_quality` is headcount farming,
 * `low_volume_high_quality` is an agent worth more investment.
 */
export type AgentQualityQuadrant =
  | 'high_volume_high_quality'
  | 'high_volume_low_quality'
  | 'low_volume_high_quality'
  | 'low_volume_low_quality'

export interface AgentScatterPoint {
  agent_user_id: number
  label: string
  customers: number
  avg_revenue: number
  revenue: number
  paying_rate: number
  quadrant: AgentQualityQuadrant
}

export interface AgentScatterModel {
  points: AgentScatterPoint[]
  /** Median customer count — the vertical quadrant guide. */
  customers_median: number
  /** Median average revenue per customer — the horizontal quadrant guide. */
  avg_revenue_median: number
}

/** The resolved, always-bounded query window backing every request. */
export interface AgentAnalyticsWindow {
  start_time: number
  end_time: number
  granularity: AgentAnalyticsGranularity
  /** True when the requested span was clamped to the 12-month hard maximum. */
  clamped: boolean
}
