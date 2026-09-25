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
import { describe, expect, it } from 'vitest'

import dayjs from '@/lib/dayjs'

import { MAX_WINDOW_DAYS, SECONDS_PER_DAY } from '../../constants'
import { ledgerRowNumber, resolveLedgerWindow } from '../ledger-window'

/** 2026-09-23 14:15 local time — mid-afternoon, so midnight is clearly behind. */
const NOW = dayjs('2026-09-23T14:15:00').unix()
const MIDNIGHT_TODAY = dayjs('2026-09-23T00:00:00').unix()

describe('resolveLedgerWindow', () => {
  it('defaults to today from midnight, not a rolling 24 hours', () => {
    const window = resolveLedgerWindow({}, NOW)

    expect(window.days).toBe(1)
    expect(window.custom).toBe(false)
    expect(window.startTimestamp).toBe(MIDNIGHT_TODAY)
    expect(window.endTimestamp).toBe(NOW)
  })

  it('counts the current day as one of the requested days', () => {
    const window = resolveLedgerWindow({ days: 7 }, NOW)

    expect(window.startTimestamp).toBe(dayjs('2026-09-17T00:00:00').unix())
    expect(window.days).toBe(7)
  })

  it('prefers an explicit range over the preset', () => {
    const start = dayjs('2026-09-01T00:00:00').unix()
    const end = dayjs('2026-09-03T23:59:59').unix()

    const window = resolveLedgerWindow({ days: 30, start, end }, NOW)

    expect(window.custom).toBe(true)
    expect(window.startTimestamp).toBe(start)
    expect(window.endTimestamp).toBe(end)
    expect(window.days).toBe(3)
    expect(window.clamped).toBe(false)
  })

  it('treats a single picked day as a one-day window', () => {
    const start = dayjs('2026-09-10T00:00:00').unix()
    const end = dayjs('2026-09-10T23:59:59').unix()

    expect(resolveLedgerWindow({ start, end }, NOW).days).toBe(1)
  })

  it('ignores a half-set range rather than querying from the epoch', () => {
    const start = dayjs('2026-09-01T00:00:00').unix()

    const window = resolveLedgerWindow({ start }, NOW)

    expect(window.custom).toBe(false)
    expect(window.startTimestamp).toBe(MIDNIGHT_TODAY)
  })

  it('ignores an inverted range', () => {
    const window = resolveLedgerWindow(
      {
        start: dayjs('2026-09-10T00:00:00').unix(),
        end: dayjs('2026-09-01T00:00:00').unix(),
      },
      NOW
    )

    expect(window.custom).toBe(false)
  })

  it('trims an over-long preset to the maximum window', () => {
    const window = resolveLedgerWindow({ days: 365 }, NOW)

    expect(window.clamped).toBe(true)
    expect(window.days).toBe(MAX_WINDOW_DAYS)
  })

  it('trims an over-long explicit range from the end backwards', () => {
    const end = dayjs('2026-09-23T23:59:59').unix()
    const start = end - 400 * SECONDS_PER_DAY

    const window = resolveLedgerWindow({ start, end }, NOW)

    expect(window.clamped).toBe(true)
    expect(window.days).toBe(MAX_WINDOW_DAYS)
    expect(window.startTimestamp).toBe(end - MAX_WINDOW_DAYS * SECONDS_PER_DAY)
  })

  it('clamps a non-positive day count to one day', () => {
    expect(resolveLedgerWindow({ days: 0 }, NOW).days).toBe(1)
    expect(resolveLedgerWindow({ days: -5 }, NOW).days).toBe(1)
  })
})

describe('ledgerRowNumber', () => {
  const base = { pageIndex: 0, pageSize: 100, totalRows: 15, descending: true }

  it('numbers the newest row with the range total under a descending sort', () => {
    expect(ledgerRowNumber({ ...base, rowIndex: 0 })).toBe(15)
    expect(ledgerRowNumber({ ...base, rowIndex: 14 })).toBe(1)
  })

  it('continues the countdown across pages', () => {
    expect(
      ledgerRowNumber({
        pageIndex: 1,
        pageSize: 10,
        rowIndex: 0,
        totalRows: 25,
        descending: true,
      })
    ).toBe(15)
  })

  it('counts up from one under an ascending sort', () => {
    expect(ledgerRowNumber({ ...base, rowIndex: 0, descending: false })).toBe(1)
    expect(
      ledgerRowNumber({
        pageIndex: 2,
        pageSize: 20,
        rowIndex: 3,
        totalRows: 100,
        descending: false,
      })
    ).toBe(44)
  })

  it('never returns a non-positive number when the total lags the rows', () => {
    expect(
      ledgerRowNumber({
        pageIndex: 3,
        pageSize: 100,
        rowIndex: 0,
        totalRows: 5,
        descending: true,
      })
    ).toBe(1)
  })
})
