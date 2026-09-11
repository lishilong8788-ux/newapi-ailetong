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
import { SECONDS_PER_DAY } from '../constants'

const RMB_SYMBOL = '¥'

/**
 * Renders a commission or revenue amount.
 *
 * These are RMB decimals straight out of `decimal(18,4)` columns — real money an
 * operator reconciles against a bank statement. They are NOT quota units, so
 * `formatQuota` (which divides by `quotaPerUnit` and honours the display
 * currency) would silently scale them into nonsense.
 */
export function formatRmb(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return `${RMB_SYMBOL}0.00`
  return `${RMB_SYMBOL}${Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`
}

/** Axis and tooltip variant: thousands collapsed so labels stay readable. */
export function formatRmbCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return `${RMB_SYMBOL}0`
  if (Math.abs(value) < 1000) return formatRmb(value)
  return `${RMB_SYMBOL}${Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)}`
}

/**
 * Renders a rate held as a fraction in [0, 1].
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

/**
 * Renders a Unix-second timestamp as `YYYY-MM-DD`, or `null` when the agent has
 * no such event yet (the API sends `0`, which would otherwise print 1970).
 */
export function formatCommissionDate(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  const date = new Date(timestamp * 1000)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Whole days between `timestamp` and `now`; `null` when there is no event. */
export function daysSince(
  timestamp: number,
  nowSeconds: number
): number | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  const elapsed = nowSeconds - timestamp
  if (elapsed < 0) return 0
  return Math.floor(elapsed / SECONDS_PER_DAY)
}
