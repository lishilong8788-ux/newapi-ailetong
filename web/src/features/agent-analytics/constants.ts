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
import type { AgentAnalyticsGranularity, AgentRankingMetric } from './types'

export const SECONDS_PER_DAY = 86_400

/** Design doc 11.5: the default window is the last 30 days. */
export const DEFAULT_WINDOW_DAYS = 30

/**
 * Design doc 11.5: no unbounded aggregation. 366 days rather than 365 so a
 * "last 12 months" selection spanning a leap day is not silently clamped.
 */
export const MAX_WINDOW_DAYS = 366

/** Design doc 11.4: no commission for this long marks a dormant agent. */
export const DORMANT_THRESHOLD_DAYS = 60

/** Design doc 11.3: the ranking chart shows the top 20. */
export const RANKING_LIMIT = 20

export const DEFAULT_GRANULARITY: AgentAnalyticsGranularity = 'day'

export const GRANULARITY_OPTIONS: ReadonlyArray<{
  value: AgentAnalyticsGranularity
  labelKey: string
}> = [
  { value: 'day', labelKey: 'Day' },
  { value: 'week', labelKey: 'Week' },
  { value: 'month', labelKey: 'Month' },
]

/** Every preset stays inside MAX_WINDOW_DAYS, so no selection escapes the bound. */
export const WINDOW_PRESETS: ReadonlyArray<{
  days: number
  labelKey: string
}> = [
  { days: 7, labelKey: 'Last 7 days' },
  { days: 30, labelKey: 'Last 30 days' },
  { days: 90, labelKey: 'Last 90 days' },
  { days: 180, labelKey: 'Last 180 days' },
  { days: 366, labelKey: 'Last 12 months' },
]

export const RANKING_METRIC_OPTIONS: ReadonlyArray<{
  value: AgentRankingMetric
  labelKey: string
}> = [
  { value: 'revenue', labelKey: 'Promoted revenue' },
  { value: 'commission', labelKey: 'Commission' },
  { value: 'customers', labelKey: 'Customers' },
  { value: 'paying_rate', labelKey: 'Paying rate' },
]

export const QUERY_KEY_ANALYTICS = 'agent-analytics'

export const ERROR_MESSAGES = {
  LOAD_FAILED: 'Failed to load distribution analytics',
  EXPORT_FAILED: 'Failed to export analytics',
} as const

export const SUCCESS_MESSAGES = {
  EXPORTED: 'Export started',
} as const
