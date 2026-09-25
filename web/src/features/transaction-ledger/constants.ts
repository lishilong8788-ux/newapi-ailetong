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
export const QUERY_KEY_LEDGER = 'transaction-ledger'

/**
 * Rows per page.
 *
 * Larger than a browsing table's because this page is read for reconciliation:
 * sorting by profit spans the whole range (the database orders it), so a big
 * page means the top of that ranking is visible without paging. The totals bar
 * is range-scoped regardless of page size.
 */
export const DEFAULT_PAGE_SIZE = 100
export const MOBILE_PAGE_SIZE = 20

/**
 * Cap on a CSV export.
 *
 * The export walks the same query the table shows, page by page, rather than
 * dumping the visible rows: the totals bar describes the filtered range, so an
 * export that covered only the current page would contradict the number the
 * reader just checked. The cap keeps that walk from turning one click into an
 * unbounded scan of the log table.
 */
export const MAX_EXPORT_ROWS = 5000
export const EXPORT_PAGE_SIZE = 500

/**
 * Unpriced share above which the backfill banner appears.
 *
 * A few unpriced requests are normal (a channel with no buy price configured
 * yet). A third of the range being unpriced usually means the margin columns
 * were added after these rows were written, which the backfill fixes. Below the
 * threshold the banner would be noise offering a no-op.
 */
export const UNPRICED_BACKFILL_HINT_RATE = 0.33

/**
 * Default lookback for the ledger, in days.
 *
 * Today, not a week: the page is read to check what has been sold and earned so
 * far today, and a week-wide default means the headline totals answer a question
 * nobody asked before they answer that one.
 */
export const DEFAULT_WINDOW_DAYS = 1

export const SECONDS_PER_DAY = 86_400

/**
 * Longest window the ledger will request.
 *
 * The page filters and totals client-side, so an unbounded range would pull an
 * arbitrary row count into the browser to answer a question the aggregate cost
 * analytics page already answers better.
 */
export const MAX_WINDOW_DAYS = 90

/**
 * Lookback presets. Label keys match the cost analytics page so the two
 * cost views share one set of translations and read the same way.
 *
 * Day-aligned, unlike the aggregate cost page's rolling window: "today" on a
 * row-level audit trail has to mean since midnight, or last night's requests
 * show up under it and the transaction count stops matching the day's books.
 */
export const WINDOW_PRESETS = [
  { days: 1, labelKey: 'Today' },
  { days: 7, labelKey: 'Last 7 days' },
  { days: 30, labelKey: 'Last 30 days' },
  { days: MAX_WINDOW_DAYS, labelKey: 'Last 90 days' },
] as const

/** Profit filter values for the toolbar. */
export const PROFIT_FILTER = {
  ALL: 'all',
  PROFITABLE: 'profitable',
  LOSS: 'loss',
  UNPRICED: 'unpriced',
} as const

export type ProfitFilterValue =
  (typeof PROFIT_FILTER)[keyof typeof PROFIT_FILTER]
