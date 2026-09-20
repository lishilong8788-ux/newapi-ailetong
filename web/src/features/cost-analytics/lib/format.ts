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
import { formatQuota, formatTokens } from '@/lib/format'

import type {
  CostChannelModelRow,
  CostChannelRow,
  CostOverview,
  CostTrendPoint,
} from '../types'

/**
 * Renders a rate held as a fraction in [0, 1] (or below 0 for negative margins).
 *
 * The API already divides, so `0.153` is 15.3%. `@/lib/format`'s `formatPercent`
 * expects a value already scaled to 0-100 and would report this as 0.15%.
 */
export function formatRate(
  value: number | null | undefined,
  digits = 2
): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${(value * 100).toFixed(digits)}%`
}

export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0'
  return Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

/** Quota → display currency, same as every other money figure on the page. */
export function formatQuotaAmount(quota: number | null | undefined): string {
  if (quota == null || !Number.isFinite(quota)) return '-'
  return formatQuota(quota)
}

export function formatTokenCount(tokens: number | null | undefined): string {
  if (tokens == null || !Number.isFinite(tokens)) return '-'
  return formatTokens(tokens)
}

export function formatDayLabel(dayTs: number): string {
  if (!Number.isFinite(dayTs) || dayTs <= 0) return '-'
  const date = new Date(dayTs * 1000)
  if (Number.isNaN(date.getTime())) return '-'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Margin badge tone: negative is danger, low is warning, else default. */
export function marginTone(
  marginRate: number | null | undefined
): 'danger' | 'warning' | 'default' {
  if (marginRate == null || !Number.isFinite(marginRate)) return 'default'
  if (marginRate < 0) return 'danger'
  if (marginRate < 0.05) return 'warning'
  return 'default'
}

/**
 * Sort by margin rate ascending — the loss-makers surface first.
 *
 * Unresolvable rates sort last: an absent rate is not a good rate, but it is not
 * an action item either, so it must not push a real loss down the list.
 */
export function sortByMarginRate<T extends { margin_rate: number | null }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const ra = a.margin_rate ?? Number.POSITIVE_INFINITY
    const rb = b.margin_rate ?? Number.POSITIVE_INFINITY
    return ra - rb
  })
}

export interface MarginRankingEntry {
  label: string
  value: number
  channelId: number
}

/** Top N channels by margin rate. Loss-makers first when descending=false. */
export function buildMarginRanking(
  rows: CostChannelRow[],
  limit: number,
  ascending: boolean
): MarginRankingEntry[] {
  const sorted = [...rows]
    .filter(
      (row) => row.margin_rate != null && Number.isFinite(row.margin_rate)
    )
    .sort((a, b) =>
      ascending
        ? (a.margin_rate as number) - (b.margin_rate as number)
        : (b.margin_rate as number) - (a.margin_rate as number)
    )
    .slice(0, limit)
  return sorted.map((row) => ({
    label: row.channel_name || `#${row.channel_id}`,
    value: row.margin_rate as number,
    channelId: row.channel_id,
  }))
}

/** Aggregate trend rows into the chart's value shape. */
export interface TrendChartDatum {
  day: string
  revenue: number
  cost: number
  rate: number | null
}

export function buildTrendChartData(
  trend: CostTrendPoint[]
): TrendChartDatum[] {
  return trend.map((point) => ({
    day: formatDayLabel(point.day_ts),
    revenue: point.revenue_quota,
    cost: point.cost_quota,
    rate:
      point.revenue_quota > 0
        ? (point.revenue_quota - point.cost_quota) / point.revenue_quota
        : null,
  }))
}

/** Overview margin, with the unknown-rate health check surfaced separately. */
export interface OverviewModel {
  revenue: string
  cost: string
  margin: string
  marginRate: string
  unknownRate: string
  unknownUnhealthy: boolean
}

export function buildOverviewModel(overview: CostOverview): OverviewModel {
  return {
    revenue: formatQuotaAmount(overview.revenue_quota),
    cost: formatQuotaAmount(overview.cost_quota),
    margin: formatQuotaAmount(overview.margin_quota),
    marginRate: formatRate(overview.margin_rate),
    unknownRate: formatRate(overview.unknown_rate),
    unknownUnhealthy:
      overview.unknown_rate != null && overview.unknown_rate > 0.05,
  }
}

// ============================================================================
// Channel × model cross margin
// ============================================================================

/**
 * Whether a row's margin only describes part of its traffic.
 *
 * The API already drops unpriced revenue from both sides of the margin, so the
 * rate itself is not wrong — it just covers fewer requests than the row's own
 * request count suggests. Past the threshold that gap is wide enough to flip a
 * sourcing decision, so the row has to say so instead of reading as fact.
 */
export function isMarginPartial(
  unknownRate: number | null | undefined,
  threshold: number
): boolean {
  if (unknownRate == null || !Number.isFinite(unknownRate)) return false
  return unknownRate > threshold
}

/** One model with every channel serving it, worst margin first. */
export interface ModelChannelGroup {
  modelName: string
  rows: CostChannelModelRow[]
  channelCount: number
  requestCount: number
  revenueQuota: number
  costQuota: number
  /** Priced margin, summed on the same base the API uses per row. */
  marginQuota: number
  /** Group margin over its priced revenue; null when nothing is priced. */
  marginRate: number | null
  /** Unpriced share across the group's requests; null when there are none. */
  unknownRate: number | null
  /** At least one channel is paying more than it earns. */
  hasLoss: boolean
  /** At least one channel's margin covers only part of its traffic. */
  hasPartialMargin: boolean
}

/**
 * Group (channel, model) rows by model, ordered by their weakest channel.
 *
 * Ranking groups by their own total would bury the case this view exists for: a
 * model on nine channels where one bleeds still averages out fine. So a group
 * carrying a loss comes first — including a loss whose rate is null, which is an
 * upstream bill against revenue that was never priced — then the worst rate
 * ascending, then the largest revenue as a stable tie-break.
 */
export function groupByModel(
  rows: CostChannelModelRow[],
  partialMarginThreshold: number
): ModelChannelGroup[] {
  const buckets = new Map<string, CostChannelModelRow[]>()
  for (const row of rows) {
    const bucket = buckets.get(row.model_name)
    if (bucket) bucket.push(row)
    else buckets.set(row.model_name, [row])
  }

  const groups: ModelChannelGroup[] = []
  for (const [modelName, bucket] of buckets) {
    // revenue − cost would count unpriced revenue as pure profit, so the group
    // total has to re-sum the priced base the API charges each row against.
    let pricedRevenue = 0
    let revenueQuota = 0
    let costQuota = 0
    let requestCount = 0
    let unknownCount = 0
    let hasLoss = false
    let hasPartialMargin = false
    for (const row of bucket) {
      pricedRevenue += Math.max(row.revenue_quota - row.unknown_quota, 0)
      revenueQuota += row.revenue_quota
      costQuota += row.cost_quota
      requestCount += row.request_count
      unknownCount += row.unknown_count
      if (row.margin_quota < 0) hasLoss = true
      if (isMarginPartial(row.unknown_rate, partialMarginThreshold)) {
        hasPartialMargin = true
      }
    }
    const marginQuota = pricedRevenue - costQuota
    groups.push({
      modelName,
      rows: sortByMarginRate(bucket),
      channelCount: bucket.length,
      requestCount,
      revenueQuota,
      costQuota,
      marginQuota,
      marginRate: pricedRevenue > 0 ? marginQuota / pricedRevenue : null,
      unknownRate: requestCount > 0 ? unknownCount / requestCount : null,
      hasLoss,
      hasPartialMargin,
    })
  }

  return groups.sort((a, b) => {
    if (a.hasLoss !== b.hasLoss) return a.hasLoss ? -1 : 1
    const worstA = a.rows[0]?.margin_rate ?? Number.POSITIVE_INFINITY
    const worstB = b.rows[0]?.margin_rate ?? Number.POSITIVE_INFINITY
    if (worstA !== worstB) return worstA - worstB
    return b.revenueQuota - a.revenueQuota
  })
}

/** Model names present in the window, for the focus filter's options. */
export function collectModelNames(rows: CostChannelModelRow[]): string[] {
  return [...new Set(rows.map((row) => row.model_name))].sort((a, b) =>
    a.localeCompare(b)
  )
}
