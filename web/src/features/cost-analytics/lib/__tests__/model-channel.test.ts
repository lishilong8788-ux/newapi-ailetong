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

import type { CostChannelModelRow } from '../../types'
import { collectModelNames, groupByModel, isMarginPartial } from '../format'

const THRESHOLD = 0.2

/**
 * Builds a (channel, model) row the way the API does: margin is the priced base
 * minus cost, so a caller only has to state revenue/cost/unpriced revenue.
 */
function row(
  overrides: Partial<CostChannelModelRow> &
    Pick<CostChannelModelRow, 'channel_id' | 'model_name'>
): CostChannelModelRow {
  const revenue = overrides.revenue_quota ?? 0
  const cost = overrides.cost_quota ?? 0
  const unknownQuota = overrides.unknown_quota ?? 0
  const requests = overrides.request_count ?? 10
  const unknownCount = overrides.unknown_count ?? 0
  const pricedBase = Math.max(revenue - unknownQuota, 0)
  return {
    channel_name: `line-${overrides.channel_id}`,
    day_ts: 0,
    token_used: 0,
    reported_quota: 0,
    request_count: requests,
    unknown_count: unknownCount,
    revenue_quota: revenue,
    cost_quota: cost,
    unknown_quota: unknownQuota,
    margin_quota: pricedBase - cost,
    margin_rate: pricedBase > 0 ? (pricedBase - cost) / pricedBase : null,
    unknown_rate: requests > 0 ? unknownCount / requests : null,
    ...overrides,
  }
}

describe('partial margin detection', () => {
  test('flags only rows whose unpriced share exceeds the threshold', () => {
    expect(isMarginPartial(0.21, THRESHOLD)).toBe(true)
    expect(isMarginPartial(0.2, THRESHOLD)).toBe(false)
    expect(isMarginPartial(0, THRESHOLD)).toBe(false)
  })

  test('an absent share is not a flag — it means the row had no requests', () => {
    expect(isMarginPartial(null, THRESHOLD)).toBe(false)
    expect(isMarginPartial(undefined, THRESHOLD)).toBe(false)
    expect(isMarginPartial(Number.NaN, THRESHOLD)).toBe(false)
  })
})

describe('grouping channels under one model', () => {
  test('orders channels inside a group worst margin first, unknown last', () => {
    const groups = groupByModel(
      [
        row({
          channel_id: 1,
          model_name: 'gpt-5',
          revenue_quota: 1000,
          cost_quota: 400,
        }),
        row({
          channel_id: 2,
          model_name: 'gpt-5',
          revenue_quota: 1000,
          cost_quota: 1300,
        }),
        row({
          channel_id: 3,
          model_name: 'gpt-5',
          revenue_quota: 0,
          cost_quota: 0,
        }),
        row({
          channel_id: 4,
          model_name: 'gpt-5',
          revenue_quota: 1000,
          cost_quota: 900,
        }),
      ],
      THRESHOLD
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].rows.map((r) => r.channel_id)).toEqual([2, 4, 1, 3])
    expect(groups[0].channelCount).toBe(4)
  })

  test('subtotals the priced base, so unpriced revenue is not booked as profit', () => {
    // Channel 2 charged 1000 of which 600 is unpriced: only 400 may face the
    // 380 cost, otherwise the row would look 620 in the black.
    const groups = groupByModel(
      [
        row({
          channel_id: 1,
          model_name: 'claude-4',
          revenue_quota: 500,
          cost_quota: 200,
        }),
        row({
          channel_id: 2,
          model_name: 'claude-4',
          revenue_quota: 1000,
          cost_quota: 380,
          unknown_quota: 600,
          request_count: 10,
          unknown_count: 6,
        }),
      ],
      THRESHOLD
    )

    const group = groups[0]
    expect(group.revenueQuota).toBe(1500)
    expect(group.costQuota).toBe(580)
    // 900 priced − 580 cost. The naive revenue − cost would claim 920.
    expect(group.marginQuota).toBe(320)
    expect(group.marginRate).toBeCloseTo(320 / 900, 10)
    expect(group.unknownRate).toBeCloseTo(0.3, 10)
    expect(group.hasPartialMargin).toBe(true)
  })

  test('a group is marked lossy even when its own total stays positive', () => {
    // The whole point of the view: eight good channels must not hide the ninth.
    const groups = groupByModel(
      [
        row({
          channel_id: 1,
          model_name: 'gpt-5',
          revenue_quota: 9000,
          cost_quota: 3000,
        }),
        row({
          channel_id: 2,
          model_name: 'gpt-5',
          revenue_quota: 100,
          cost_quota: 300,
        }),
      ],
      THRESHOLD
    )

    expect(groups[0].marginQuota).toBeGreaterThan(0)
    expect(groups[0].hasLoss).toBe(true)
    expect(groups[0].rows[0].channel_id).toBe(2)
  })

  test('cost against fully unpriced revenue counts as a loss despite a null rate', () => {
    const groups = groupByModel(
      [
        row({
          channel_id: 1,
          model_name: 'free-tier',
          revenue_quota: 800,
          unknown_quota: 800,
          cost_quota: 500,
          request_count: 4,
          unknown_count: 4,
        }),
      ],
      THRESHOLD
    )

    expect(groups[0].rows[0].margin_rate).toBeNull()
    expect(groups[0].marginRate).toBeNull()
    expect(groups[0].marginQuota).toBe(-500)
    expect(groups[0].hasLoss).toBe(true)
  })

  test('lossy models sort ahead of healthy ones, then by worst rate', () => {
    const groups = groupByModel(
      [
        row({
          channel_id: 1,
          model_name: 'healthy',
          revenue_quota: 1000,
          cost_quota: 100,
        }),
        row({
          channel_id: 2,
          model_name: 'mild-loss',
          revenue_quota: 1000,
          cost_quota: 1100,
        }),
        row({
          channel_id: 3,
          model_name: 'deep-loss',
          revenue_quota: 1000,
          cost_quota: 3000,
        }),
      ],
      THRESHOLD
    )

    expect(groups.map((g) => g.modelName)).toEqual([
      'deep-loss',
      'mild-loss',
      'healthy',
    ])
  })
})

describe('model filter options', () => {
  test('deduplicates model names across channels and sorts them', () => {
    const names = collectModelNames([
      row({ channel_id: 2, model_name: 'gpt-5' }),
      row({ channel_id: 1, model_name: 'claude-4' }),
      row({ channel_id: 3, model_name: 'gpt-5' }),
    ])

    expect(names).toEqual(['claude-4', 'gpt-5'])
  })
})
