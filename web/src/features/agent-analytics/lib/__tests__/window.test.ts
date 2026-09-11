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
import { describe, expect, test } from 'vitest'

import {
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  SECONDS_PER_DAY,
} from '../../constants'
import { normalizeGranularity, resolveWindow, windowDays } from '../analytics'
import { NOW } from './fixtures'

describe('granularity normalization', () => {
  test('accepts the three supported bucket widths', () => {
    expect(normalizeGranularity('day')).toBe('day')
    expect(normalizeGranularity('week')).toBe('week')
    expect(normalizeGranularity('month')).toBe('month')
  })

  test('falls back to day for an absent or unknown value from the URL', () => {
    expect(normalizeGranularity(undefined)).toBe('day')
    expect(normalizeGranularity('hour')).toBe('day')
    expect(normalizeGranularity('')).toBe('day')
  })
})

describe('window resolution', () => {
  test('defaults to the last 30 days when no range is given', () => {
    const window = resolveWindow({}, NOW)

    expect(window).toEqual({
      start_time: NOW - DEFAULT_WINDOW_DAYS * SECONDS_PER_DAY,
      end_time: NOW,
      granularity: 'day',
      clamped: false,
    })
  })

  test('keeps a valid explicit range untouched', () => {
    const start = NOW - 90 * SECONDS_PER_DAY

    expect(
      resolveWindow(
        { start_time: start, end_time: NOW, granularity: 'week' },
        NOW
      )
    ).toEqual({
      start_time: start,
      end_time: NOW,
      granularity: 'week',
      clamped: false,
    })
  })

  test('clamps a range longer than the 12-month maximum and reports the clamp', () => {
    const window = resolveWindow(
      { start_time: NOW - 900 * SECONDS_PER_DAY, end_time: NOW },
      NOW
    )

    expect(window.start_time).toBe(NOW - MAX_WINDOW_DAYS * SECONDS_PER_DAY)
    expect(window.end_time).toBe(NOW)
    expect(window.clamped).toBe(true)
  })

  test('accepts a range exactly at the maximum without clamping', () => {
    const window = resolveWindow(
      { start_time: NOW - MAX_WINDOW_DAYS * SECONDS_PER_DAY, end_time: NOW },
      NOW
    )

    expect(window.clamped).toBe(false)
    expect(windowDays(window)).toBe(MAX_WINDOW_DAYS)
  })

  test('falls back to the default window when the range is inverted', () => {
    const window = resolveWindow(
      { start_time: NOW, end_time: NOW - 10 * SECONDS_PER_DAY },
      NOW
    )

    const end = NOW - 10 * SECONDS_PER_DAY
    expect(window.start_time).toBe(end - DEFAULT_WINDOW_DAYS * SECONDS_PER_DAY)
    expect(window.end_time).toBe(end)
  })

  test('falls back to the default window when start equals end', () => {
    const window = resolveWindow({ start_time: NOW, end_time: NOW }, NOW)

    expect(window.start_time).toBe(NOW - DEFAULT_WINDOW_DAYS * SECONDS_PER_DAY)
    expect(window.end_time).toBe(NOW)
  })

  test('ignores a non-positive start so a zeroed URL param cannot request all time', () => {
    // `?startTime=0` is the shape an unbounded query would take; it must resolve
    // to the default window, not to the epoch.
    const window = resolveWindow({ start_time: 0, end_time: NOW }, NOW)

    expect(window.start_time).toBe(NOW - DEFAULT_WINDOW_DAYS * SECONDS_PER_DAY)
    expect(window.clamped).toBe(false)
  })

  test('treats a non-finite bound as absent', () => {
    const window = resolveWindow(
      { start_time: Number.NaN, end_time: Number.NaN },
      NOW
    )

    expect(window.start_time).toBe(NOW - DEFAULT_WINDOW_DAYS * SECONDS_PER_DAY)
    expect(window.end_time).toBe(NOW)
  })

  test('truncates fractional timestamps to whole seconds', () => {
    const window = resolveWindow(
      { start_time: NOW - 100.7, end_time: NOW + 0.9 },
      NOW
    )

    expect(Number.isInteger(window.start_time)).toBe(true)
    expect(Number.isInteger(window.end_time)).toBe(true)
  })
})

describe('window length', () => {
  test('reports whole days for an exact multiple', () => {
    expect(
      windowDays({
        start_time: NOW - 30 * SECONDS_PER_DAY,
        end_time: NOW,
        granularity: 'day',
        clamped: false,
      })
    ).toBe(30)
  })

  test('rounds a partial day up so the label never understates the window', () => {
    expect(
      windowDays({
        start_time: NOW - (7 * SECONDS_PER_DAY + 1),
        end_time: NOW,
        granularity: 'day',
        clamped: false,
      })
    ).toBe(8)
  })

  test('reports zero for an empty span', () => {
    expect(
      windowDays({
        start_time: NOW,
        end_time: NOW,
        granularity: 'day',
        clamped: false,
      })
    ).toBe(0)
  })
})
