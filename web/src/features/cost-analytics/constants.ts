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

export const SECONDS_PER_DAY = 86_400

export const DEFAULT_WINDOW_DAYS = 30

export const MAX_WINDOW_DAYS = 366

export const RANKING_LIMIT = 10

export const WINDOW_PRESETS: ReadonlyArray<{
  days: number
  labelKey: string
}> = [
  { days: 1, labelKey: 'Today' },
  { days: 7, labelKey: 'Last 7 days' },
  { days: 30, labelKey: 'Last 30 days' },
  { days: 90, labelKey: 'Last 90 days' },
]

export const QUERY_KEY_COST_OVERVIEW = 'cost-overview'
export const QUERY_KEY_COST_TREND = 'cost-trend'
export const QUERY_KEY_COST_CHANNELS = 'cost-channels'
export const QUERY_KEY_COST_CHANNEL_MODELS = 'cost-channel-models'
export const QUERY_KEY_COST_INVENTORY = 'cost-inventory'

/** Sentinel for "no model focus" in the channel × model filter. */
export const ALL_MODELS_FILTER = '__all__'

/**
 * Unknown-rate above which margin numbers become untrustworthy and the page
 * has to say so instead of showing them as fact (design doc §4.5).
 */
export const UNKNOWN_RATE_WARN_THRESHOLD = 0.05

/**
 * Per-row unpriced share above which a margin is flagged as covering only part
 * of the traffic.
 *
 * Looser than the page-level 5% on purpose: that one gates whether the whole
 * ledger can be trusted, while a single (channel, model) pair routinely carries
 * a few unpriced calls without the comparison losing its meaning. Past ~20% the
 * margin describes a minority-to-be-ignored slice and has to be marked.
 */
export const ROW_UNKNOWN_RATE_WARN_THRESHOLD = 0.2
