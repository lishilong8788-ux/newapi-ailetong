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

/** Sort channels by margin rate ascending — the loss-makers surface first. */
export function sortByMarginRate(rows: CostChannelRow[]): CostChannelRow[] {
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
    .filter((row) => row.margin_rate != null && Number.isFinite(row.margin_rate))
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

export function buildTrendChartData(trend: CostTrendPoint[]): TrendChartDatum[] {
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
