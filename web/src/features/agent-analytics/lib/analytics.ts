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
import {
  DEFAULT_WINDOW_DAYS,
  DORMANT_THRESHOLD_DAYS,
  MAX_WINDOW_DAYS,
  RANKING_LIMIT,
  SECONDS_PER_DAY,
} from '../constants'
import type {
  AgentAnalyticsGranularity,
  AgentAnalyticsRow,
  AgentAnalyticsTrendPoint,
  AgentAnalyticsWindow,
  AgentQualityQuadrant,
  AgentRankingEntry,
  AgentRankingMetric,
  AgentScatterModel,
  AgentScatterPoint,
  AgentTrendBucket,
} from '../types'

// ============================================================================
// Rates
// ============================================================================

/**
 * Divides while treating a zero or invalid denominator as "no rate yet" (0)
 * rather than NaN or Infinity.
 *
 * Every rate on this page is a ratio of two sums that can legitimately be zero:
 * a fresh install has no customers and no revenue, and a NaN leaking into a
 * chart axis collapses the whole chart.
 */
export function safeRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0
  if (denominator <= 0) return 0
  const rate = numerator / denominator
  return Number.isFinite(rate) ? rate : 0
}

/** Paying customers over promoted customers. */
export function computePayingRate(
  payingCustomers: number,
  promotedCustomers: number
): number {
  return safeRate(payingCustomers, promotedCustomers)
}

/**
 * Commission spend over promoted revenue — the blended cost of the channel.
 *
 * Design doc 11.2 calls this the most important number on the page: it drifts
 * away from the nominal default rate as the mix of per-agent rates shifts.
 */
export function computeEffectiveRate(
  commission: number,
  revenue: number
): number {
  return safeRate(commission, revenue)
}

// ============================================================================
// Query window
// ============================================================================

/**
 * Resolves a requested range into a window that always has both ends and never
 * exceeds the 12-month hard maximum (design doc 11.5).
 *
 * An absent or reversed range falls back to the default 30 days. An oversized
 * range keeps its end and pulls the start forward, so "recent" stays recent, and
 * reports `clamped` so the UI can say the window was trimmed.
 */
export function resolveWindow(
  input: {
    start_time?: number
    end_time?: number
    granularity?: string
  },
  nowSeconds: number
): AgentAnalyticsWindow {
  const granularity = normalizeGranularity(input.granularity)
  const maxSpan = MAX_WINDOW_DAYS * SECONDS_PER_DAY
  const defaultSpan = DEFAULT_WINDOW_DAYS * SECONDS_PER_DAY

  const end =
    Number.isFinite(input.end_time) && (input.end_time as number) > 0
      ? Math.floor(input.end_time as number)
      : nowSeconds
  const requestedStart =
    Number.isFinite(input.start_time) && (input.start_time as number) > 0
      ? Math.floor(input.start_time as number)
      : end - defaultSpan

  if (requestedStart >= end) {
    return {
      start_time: end - defaultSpan,
      end_time: end,
      granularity,
      clamped: false,
    }
  }

  if (end - requestedStart > maxSpan) {
    return {
      start_time: end - maxSpan,
      end_time: end,
      granularity,
      clamped: true,
    }
  }

  return {
    start_time: requestedStart,
    end_time: end,
    granularity,
    clamped: false,
  }
}

export function normalizeGranularity(
  value: string | undefined
): AgentAnalyticsGranularity {
  if (value === 'week' || value === 'month') return value
  return 'day'
}

/** Whole days covered by the window, rounded up so a partial day still counts. */
export function windowDays(window: AgentAnalyticsWindow): number {
  const span = window.end_time - window.start_time
  if (span <= 0) return 0
  return Math.ceil(span / SECONDS_PER_DAY)
}

// ============================================================================
// Trend bucketing
// ============================================================================

type CalendarDate = { year: number; month: number; day: number }

function parseIsoDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * The bucket a `YYYY-MM-DD` day belongs to.
 *
 * Week buckets are keyed by their ISO Monday, month buckets by `YYYY-MM`. All
 * arithmetic is UTC so the same input yields the same bucket on every machine —
 * a local-time `Date` would shift days across a timezone boundary and make the
 * results untestable.
 */
export function bucketKey(
  date: string,
  granularity: AgentAnalyticsGranularity
): string {
  const parsed = parseIsoDate(date)
  if (!parsed) return date

  if (granularity === 'month') {
    return `${parsed.year}-${pad2(parsed.month)}`
  }

  if (granularity === 'week') {
    const utc = Date.UTC(parsed.year, parsed.month - 1, parsed.day)
    const weekday = new Date(utc).getUTCDay()
    // getUTCDay() is 0 on Sunday; ISO weeks start on Monday, so Sunday is day 7.
    const offset = weekday === 0 ? 6 : weekday - 1
    const monday = new Date(utc - offset * SECONDS_PER_DAY * 1000)
    return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(
      monday.getUTCDate()
    )}`
  }

  return `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}`
}

/**
 * Folds the API's daily points into the requested bucket width, ascending by key.
 *
 * Counts and amounts add up; the effective rate is recomputed from the bucket's
 * own totals because averaging per-day rates would weight a quiet day the same
 * as a busy one. Requesting `day` on daily data is a no-op beyond sorting, which
 * keeps the function safe to apply to whatever the backend already bucketed.
 */
export function bucketTrend(
  points: readonly AgentAnalyticsTrendPoint[],
  granularity: AgentAnalyticsGranularity
): AgentTrendBucket[] {
  const buckets = new Map<string, AgentTrendBucket>()

  for (const point of points) {
    const key = bucketKey(point.date, granularity)
    const existing = buckets.get(key)
    const newCustomers = toFiniteNumber(point.new_customers)
    const payingCustomers = toFiniteNumber(point.paying_customers)
    const revenue = toFiniteNumber(point.revenue)
    const commission = toFiniteNumber(point.commission)

    if (existing) {
      existing.new_customers += newCustomers
      existing.paying_customers += payingCustomers
      existing.revenue += revenue
      existing.commission += commission
      continue
    }

    buckets.set(key, {
      key,
      new_customers: newCustomers,
      paying_customers: payingCustomers,
      revenue,
      commission,
      effective_rate: 0,
    })
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      effective_rate: computeEffectiveRate(bucket.commission, bucket.revenue),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function toFiniteNumber(value: number): number {
  return Number.isFinite(value) ? Number(value) : 0
}

// ============================================================================
// Ranking
// ============================================================================

function rankingValue(
  row: AgentAnalyticsRow,
  metric: AgentRankingMetric
): number {
  if (metric === 'commission') return toFiniteNumber(row.commission)
  if (metric === 'customers') return toFiniteNumber(row.customer_count)
  if (metric === 'paying_rate') {
    return computePayingRate(row.paying_customer_count, row.customer_count)
  }
  return toFiniteNumber(row.revenue)
}

/** Display name for an agent, falling back through the identifiers we have. */
export function agentLabel(row: AgentAnalyticsRow): string {
  if (row.display_name) return row.display_name
  if (row.username) return row.username
  return `#${row.agent_user_id}`
}

/**
 * Top agents by one metric, descending, capped at {@link RANKING_LIMIT}.
 *
 * Ties break on the agent id so the bar order is stable between renders instead
 * of shuffling on every refetch. Zero-valued agents are dropped: a bar of length
 * zero carries no ranking information and just eats vertical space.
 */
export function buildRanking(
  rows: readonly AgentAnalyticsRow[],
  metric: AgentRankingMetric,
  limit: number = RANKING_LIMIT
): AgentRankingEntry[] {
  return rows
    .map((row) => ({
      agent_user_id: row.agent_user_id,
      label: agentLabel(row),
      value: rankingValue(row, metric),
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value
      return a.agent_user_id - b.agent_user_id
    })
    .slice(0, Math.max(0, limit))
}

// ============================================================================
// Customer-quality scatter
// ============================================================================

/** Median of a numeric sample; 0 for an empty sample. Even samples average the
 * two middle values. */
export function median(values: readonly number[]): number {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Which quadrant a point falls in, relative to the cohort medians.
 *
 * A point sitting exactly on a guide counts as the high side: the guide is the
 * cohort median, and an agent at the median is not below it.
 */
export function classifyQuadrant(
  customers: number,
  avgRevenue: number,
  customersGuide: number,
  avgRevenueGuide: number
): AgentQualityQuadrant {
  const highVolume = customers >= customersGuide
  const highQuality = avgRevenue >= avgRevenueGuide

  if (highVolume && highQuality) return 'high_volume_high_quality'
  if (highVolume) return 'high_volume_low_quality'
  if (highQuality) return 'low_volume_high_quality'
  return 'low_volume_low_quality'
}

/**
 * One scatter point per agent: customer count against average revenue per
 * customer, plus the quadrant that reading implies (design doc 11.3).
 *
 * The average is recomputed from revenue and customer count rather than trusting
 * `avg_revenue_per_customer`, so the axis and the quadrant can never disagree
 * with the revenue the same row reports. Agents with no customers are excluded:
 * their average revenue is undefined, and plotting them at the origin would drag
 * both medians toward zero and mislabel the real cohort.
 */
export function buildScatterModel(
  rows: readonly AgentAnalyticsRow[]
): AgentScatterModel {
  const seeded = rows
    .filter((row) => toFiniteNumber(row.customer_count) > 0)
    .map((row) => {
      const customers = toFiniteNumber(row.customer_count)
      const revenue = toFiniteNumber(row.revenue)
      return {
        agent_user_id: row.agent_user_id,
        label: agentLabel(row),
        customers,
        avg_revenue: safeRate(revenue, customers),
        revenue,
        paying_rate: computePayingRate(row.paying_customer_count, customers),
      }
    })

  const customersMedian = median(seeded.map((point) => point.customers))
  const avgRevenueMedian = median(seeded.map((point) => point.avg_revenue))

  const points: AgentScatterPoint[] = seeded.map((point) => ({
    ...point,
    quadrant: classifyQuadrant(
      point.customers,
      point.avg_revenue,
      customersMedian,
      avgRevenueMedian
    ),
  }))

  return {
    points,
    customers_median: customersMedian,
    avg_revenue_median: avgRevenueMedian,
  }
}

// ============================================================================
// Dormancy
// ============================================================================

/**
 * Whether an agent has gone quiet long enough to belong on the operations
 * follow-up list (design doc 11.4: 60 days without a new commission).
 *
 * An agent that has never earned a commission is not "dormant" — it has not
 * started. Those are an onboarding problem, not a re-activation one, so they are
 * reported separately by {@link hasNeverEarned}.
 */
export function isDormant(
  lastCommissionTime: number,
  nowSeconds: number,
  thresholdDays: number = DORMANT_THRESHOLD_DAYS
): boolean {
  if (!Number.isFinite(lastCommissionTime) || lastCommissionTime <= 0) {
    return false
  }
  const elapsed = nowSeconds - lastCommissionTime
  if (elapsed <= 0) return false
  return elapsed > thresholdDays * SECONDS_PER_DAY
}

export function hasNeverEarned(row: AgentAnalyticsRow): boolean {
  return (
    !Number.isFinite(row.last_commission_time) || row.last_commission_time <= 0
  )
}

/** Count of agents needing an operations follow-up, for the table's caption. */
export function countDormant(
  rows: readonly AgentAnalyticsRow[],
  nowSeconds: number,
  thresholdDays: number = DORMANT_THRESHOLD_DAYS
): number {
  return rows.filter((row) =>
    isDormant(row.last_commission_time, nowSeconds, thresholdDays)
  ).length
}

// ============================================================================
// CSV export
// ============================================================================

/** Header keys, in column order. Callers translate them before writing. */
export const CSV_HEADER_KEYS: readonly string[] = [
  'Agent',
  'Username',
  'Customers',
  'Paying customers',
  'Paying rate',
  'Promoted revenue',
  'Avg revenue per customer',
  'Commission',
  'Effective commission rate',
  'First commission',
  'Last commission',
  '30-day activity',
]

/**
 * One CSV row per agent, as raw strings in {@link CSV_HEADER_KEYS} order.
 *
 * Rates go out as plain decimals and amounts without a currency symbol: the file
 * is opened in a spreadsheet, where `15.30%` and `¥1,234.00` are text and will
 * not sum. Absent timestamps become empty cells rather than `1970-01-01`.
 */
export function buildCsvRow(row: AgentAnalyticsRow): string[] {
  const customers = toFiniteNumber(row.customer_count)
  const revenue = toFiniteNumber(row.revenue)

  return [
    agentLabel(row),
    row.username ?? '',
    String(customers),
    String(toFiniteNumber(row.paying_customer_count)),
    computePayingRate(row.paying_customer_count, customers).toFixed(4),
    revenue.toFixed(2),
    safeRate(revenue, customers).toFixed(2),
    toFiniteNumber(row.commission).toFixed(2),
    computeEffectiveRate(row.commission, revenue).toFixed(4),
    isoDateOrEmpty(row.first_commission_time),
    isoDateOrEmpty(row.last_commission_time),
    String(toFiniteNumber(row.active_30d)),
  ]
}

function isoDateOrEmpty(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const date = new Date(timestamp * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/**
 * Serialises rows into RFC 4180 CSV text.
 *
 * Fields containing a comma, quote or newline are quoted and inner quotes
 * doubled — agent display names are free text and a single stray comma would
 * otherwise shift every following column.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly string[][]
): string {
  return [header, ...rows]
    .map((cells) => cells.map(escapeCsvCell).join(','))
    .join('\r\n')
}

function escapeCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replaceAll('"', '""')}"`
}
