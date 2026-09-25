import { describe, expect, it } from 'vitest'

import type { CostTrendPoint } from '../../types'
import { buildTrendChartData } from '../format'

/**
 * The chart's day axis must echo the server's own label, not re-derive it from
 * `day_ts` in the browser's timezone.
 *
 * `day_ts` is local midnight *on the server*. A UTC+8 server's 09-23 bucket is
 * 1790092800, which a UTC viewer's `Date` reads as 09-22 16:00 — so deriving the
 * label client-side silently shifts every point back a day for anyone whose
 * offset is below the server's. Which day a bucket belongs to is a server fact.
 */
const point = (over: Partial<CostTrendPoint>): CostTrendPoint => ({
  day_ts: 1790092800,
  request_count: 31,
  token_used: 961814,
  revenue_quota: 17611,
  cost_quota: 14658,
  unknown_count: 0,
  unknown_quota: 0,
  ...over,
})

describe('buildTrendChartData day labels', () => {
  it("uses the server's label verbatim, whatever the browser timezone", () => {
    // The label deliberately disagrees with what `day_ts` yields locally. That
    // disagreement is the whole point: this suite runs on a UTC+8 machine, where
    // deriving the label from 1790092800 also lands on 09-23, so an assertion
    // that merely expects 09-23 would pass just as happily with the old
    // browser-side derivation. Pinning a value only the server could have sent
    // makes the test fail on any machine if the fallback is taken.
    const [datum] = buildTrendChartData([
      point({ day: '2026-01-02', day_ts: 1790092800 }),
    ])
    expect(datum.day).toBe('2026-01-02')
  })

  it('keeps each bucket on its own day, in order', () => {
    const data = buildTrendChartData([
      point({ day: '2026-09-23', day_ts: 1790092800 }),
      point({ day: '2026-09-24', day_ts: 1790179200 }),
    ])
    expect(data.map((d) => d.day)).toEqual(['2026-09-23', '2026-09-24'])
  })

  it('falls back to the timestamp when the server sends no label', () => {
    // A backend predating the field must still produce a readable axis rather
    // than a blank category.
    const [datum] = buildTrendChartData([point({ day: undefined })])
    expect(datum.day).not.toBe('')
    expect(datum.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('carries the money figures through unchanged', () => {
    const [datum] = buildTrendChartData([
      point({ day: '2026-09-23', revenue_quota: 17611, cost_quota: 14658 }),
    ])
    expect(datum.revenue).toBe(17611)
    expect(datum.cost).toBe(14658)
    expect(datum.rate).toBeCloseTo((17611 - 14658) / 17611)
  })
})
