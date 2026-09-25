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
import dayjs from '@/lib/dayjs'

import {
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  SECONDS_PER_DAY,
} from '../constants'

export interface LedgerWindow {
  /** True while an explicit calendar range is driving the query. */
  custom: boolean
  /** Calendar days the window spans, inclusive of both ends. */
  days: number
  /** True when the request exceeded MAX_WINDOW_DAYS and was trimmed. */
  clamped: boolean
  startTimestamp: number
  endTimestamp: number
}

/**
 * Resolves the active window from URL search state.
 *
 * Presets are day-aligned: "today" starts at this morning's midnight rather than
 * 24 hours ago, because on a row-level ledger a rolling window silently mixes
 * last night's requests into today's transaction count. An explicit calendar
 * range wins over the preset, and needs both bounds — a half-set range is a
 * mid-edit URL, not a window, and honouring it would query from the epoch.
 */
export function resolveLedgerWindow(
  search: { days?: number; start?: number; end?: number },
  nowSeconds: number
): LedgerWindow {
  const start = search.start
  const end = search.end
  const hasExplicitRange =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    (start as number) > 0 &&
    (end as number) >= (start as number)

  if (hasExplicitRange) {
    const endTimestamp = end as number
    const spanDays = Math.max(
      1,
      Math.ceil((endTimestamp - (start as number)) / SECONDS_PER_DAY)
    )
    const clamped = spanDays > MAX_WINDOW_DAYS
    return {
      custom: true,
      days: clamped ? MAX_WINDOW_DAYS : spanDays,
      clamped,
      startTimestamp: clamped
        ? endTimestamp - MAX_WINDOW_DAYS * SECONDS_PER_DAY
        : (start as number),
      endTimestamp,
    }
  }

  const requestedDays = search.days ?? DEFAULT_WINDOW_DAYS
  const clamped = requestedDays > MAX_WINDOW_DAYS
  const days = clamped ? MAX_WINDOW_DAYS : Math.max(1, requestedDays)

  // `days - 1` because the window includes today: a 7-day window is the six
  // previous midnights plus everything so far today, not eight calendar days.
  return {
    custom: false,
    days,
    clamped,
    startTimestamp: dayjs
      .unix(nowSeconds)
      .startOf('day')
      .subtract(days - 1, 'day')
      .unix(),
    endTimestamp: nowSeconds,
  }
}

/**
 * The number shown in the ledger's leading column.
 *
 * Counts down from the range total under a descending sort and up from 1 under an
 * ascending one, so the newest transaction always carries the largest number and
 * the first row of the default view doubles as "how many transactions are in this
 * range". Purely positional: filtering renumbers it by design.
 *
 * Falls back to plain 1-based position when the total is not known yet (the first
 * render of a page has rows before the count lands), which is the only way this
 * could otherwise produce a zero or negative number.
 */
export function ledgerRowNumber(params: {
  pageIndex: number
  pageSize: number
  rowIndex: number
  totalRows: number
  descending: boolean
}): number {
  const offset = params.pageIndex * params.pageSize + params.rowIndex
  if (!params.descending || !Number.isFinite(params.totalRows)) {
    return offset + 1
  }
  return Math.max(1, params.totalRows - offset)
}
