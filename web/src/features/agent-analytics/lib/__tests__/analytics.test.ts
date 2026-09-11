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

import type { AgentAnalyticsTrendPoint } from '../../types'
import {
  bucketKey,
  bucketTrend,
  computeEffectiveRate,
  computePayingRate,
  safeRate,
} from '../analytics'

function point(
  date: string,
  overrides: Partial<AgentAnalyticsTrendPoint> = {}
): AgentAnalyticsTrendPoint {
  return {
    date,
    new_customers: 0,
    paying_customers: 0,
    revenue: 0,
    commission: 0,
    ...overrides,
  }
}

describe('rate computation', () => {
  test('returns 0 when the denominator is zero so a fresh install shows no rate', () => {
    expect(safeRate(5, 0)).toBe(0)
    expect(computePayingRate(0, 0)).toBe(0)
    expect(computeEffectiveRate(120, 0)).toBe(0)
  })

  test('returns a fraction, not a percentage, for a normal paying rate', () => {
    expect(computePayingRate(12, 48)).toBe(0.25)
  })

  test('computes the effective commission rate from spend over revenue', () => {
    expect(computeEffectiveRate(1_500, 10_000)).toBe(0.15)
  })

  test('reports an effective rate above the nominal rate when spend outpaces revenue', () => {
    // A refund reversal can leave commission high against shrunken revenue; the
    // page must show the real cost rather than clamp it to a plausible range.
    expect(computeEffectiveRate(600, 1_000)).toBe(0.6)
  })

  test('returns 0 for a negative denominator instead of a negative rate', () => {
    expect(safeRate(10, -100)).toBe(0)
  })

  test('returns 0 when either side is not a finite number', () => {
    expect(safeRate(Number.NaN, 10)).toBe(0)
    expect(safeRate(10, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('bucket key derivation', () => {
  test('keeps the calendar day as the key at day granularity', () => {
    expect(bucketKey('2026-03-18', 'day')).toBe('2026-03-18')
  })

  test('maps a mid-week day to the ISO Monday of its week', () => {
    // 2026-03-18 is a Wednesday.
    expect(bucketKey('2026-03-18', 'week')).toBe('2026-03-16')
  })

  test('keeps a Monday as its own week key', () => {
    expect(bucketKey('2026-03-16', 'week')).toBe('2026-03-16')
  })

  test('maps a Sunday back to the preceding Monday, not forward', () => {
    // Sunday closes the ISO week; getUTCDay() reports it as 0, so this is the
    // case a naive offset gets wrong by six days.
    expect(bucketKey('2026-03-22', 'week')).toBe('2026-03-16')
  })

  test('crosses a month boundary within one week bucket', () => {
    expect(bucketKey('2026-04-01', 'week')).toBe('2026-03-30')
  })

  test('reduces a day to year and month at month granularity', () => {
    expect(bucketKey('2026-03-18', 'month')).toBe('2026-03')
  })

  test('passes an unparseable date through unchanged rather than inventing a bucket', () => {
    expect(bucketKey('not-a-date', 'week')).toBe('not-a-date')
  })
})

describe('trend bucketing', () => {
  const week: AgentAnalyticsTrendPoint[] = [
    point('2026-03-16', { new_customers: 3, revenue: 1_000, commission: 100 }),
    point('2026-03-17', { new_customers: 2, revenue: 500, commission: 50 }),
    point('2026-03-22', { new_customers: 1, revenue: 500, commission: 100 }),
    point('2026-03-23', { new_customers: 4, revenue: 2_000, commission: 300 }),
  ]

  test('sums counts and amounts into one bucket per ISO week', () => {
    const result = bucketTrend(week, 'week')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      key: '2026-03-16',
      new_customers: 6,
      paying_customers: 0,
      revenue: 2_000,
      commission: 250,
      effective_rate: 0.125,
    })
    expect(result[1]).toEqual({
      key: '2026-03-23',
      new_customers: 4,
      paying_customers: 0,
      revenue: 2_000,
      commission: 300,
      effective_rate: 0.15,
    })
  })

  test('recomputes the effective rate from bucket totals rather than averaging daily rates', () => {
    // Day rates are 0% and 50%; a naive mean would report 25%, but the week
    // spent 100 against 1000 of revenue, which is 10%.
    const result = bucketTrend(
      [
        point('2026-03-16', { revenue: 800, commission: 0 }),
        point('2026-03-17', { revenue: 200, commission: 100 }),
      ],
      'week'
    )

    expect(result).toHaveLength(1)
    expect(result[0].effective_rate).toBe(0.1)
  })

  test('orders buckets ascending by key regardless of input order', () => {
    const result = bucketTrend(
      [point('2026-05-02'), point('2026-01-09'), point('2026-03-11')],
      'month'
    )

    expect(result.map((bucket) => bucket.key)).toEqual([
      '2026-01',
      '2026-03',
      '2026-05',
    ])
  })

  test('sorts daily input without merging it when granularity is day', () => {
    const result = bucketTrend(
      [
        point('2026-03-17', { new_customers: 2 }),
        point('2026-03-16', { new_customers: 3 }),
      ],
      'day'
    )

    expect(result.map((bucket) => bucket.key)).toEqual([
      '2026-03-16',
      '2026-03-17',
    ])
    expect(result.map((bucket) => bucket.new_customers)).toEqual([3, 2])
  })

  test('returns an empty series for an empty window instead of a zero-filled one', () => {
    expect(bucketTrend([], 'month')).toEqual([])
  })

  test('treats a non-finite metric as zero so one bad point cannot poison a bucket', () => {
    const result = bucketTrend(
      [
        point('2026-03-16', { revenue: Number.NaN, commission: 50 }),
        point('2026-03-17', { revenue: 1_000, commission: 50 }),
      ],
      'week'
    )

    expect(result[0].revenue).toBe(1_000)
    expect(result[0].commission).toBe(100)
  })
})
