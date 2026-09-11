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

import { buildScatterModel, classifyQuadrant, median } from '../analytics'
import { agentRow } from './fixtures'

describe('median', () => {
  test('returns the middle value of an odd-sized sample', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  test('averages the two middle values of an even-sized sample', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  test('returns 0 for an empty sample so an agentless install has usable guides', () => {
    expect(median([])).toBe(0)
  })

  test('ignores non-finite values rather than returning NaN', () => {
    expect(median([2, Number.NaN, 4, 6])).toBe(4)
  })
})

describe('quadrant classification', () => {
  test('puts high volume and high average revenue in the top-right quadrant', () => {
    expect(classifyQuadrant(100, 500, 50, 300)).toBe('high_volume_high_quality')
  })

  test('puts high volume with low average revenue in the headcount-farming quadrant', () => {
    expect(classifyQuadrant(100, 100, 50, 300)).toBe('high_volume_low_quality')
  })

  test('puts low volume with high average revenue in the invest-more quadrant', () => {
    expect(classifyQuadrant(10, 900, 50, 300)).toBe('low_volume_high_quality')
  })

  test('puts low volume and low average revenue in the bottom-left quadrant', () => {
    expect(classifyQuadrant(10, 100, 50, 300)).toBe('low_volume_low_quality')
  })

  test('counts a point sitting exactly on both guides as the high side', () => {
    expect(classifyQuadrant(50, 300, 50, 300)).toBe('high_volume_high_quality')
  })
})

describe('scatter model', () => {
  test('derives average revenue per customer from revenue and customer count', () => {
    const model = buildScatterModel([
      agentRow({ agent_user_id: 1, customer_count: 4, revenue: 1_000 }),
    ])

    expect(model.points).toHaveLength(1)
    expect(model.points[0].avg_revenue).toBe(250)
  })

  test('ignores the API average and recomputes it so the axis matches the revenue column', () => {
    const model = buildScatterModel([
      agentRow({
        agent_user_id: 1,
        customer_count: 10,
        revenue: 5_000,
        avg_revenue_per_customer: 999_999,
      }),
    ])

    expect(model.points[0].avg_revenue).toBe(500)
  })

  test('separates a high-volume low-quality agent from a low-volume high-quality one', () => {
    const model = buildScatterModel([
      agentRow({
        agent_user_id: 1,
        display_name: 'Volume Vic',
        customer_count: 100,
        revenue: 10_000,
      }),
      agentRow({
        agent_user_id: 2,
        display_name: 'Quality Qi',
        customer_count: 10,
        revenue: 20_000,
      }),
      agentRow({
        agent_user_id: 3,
        display_name: 'Middle Ma',
        customer_count: 40,
        revenue: 20_000,
      }),
    ])

    // Customer medians: [10, 40, 100] -> 40. Averages: [100, 500, 2000] -> 500.
    expect(model.customers_median).toBe(40)
    expect(model.avg_revenue_median).toBe(500)

    const byName = new Map(
      model.points.map((point) => [point.label, point.quadrant])
    )
    expect(byName.get('Volume Vic')).toBe('high_volume_low_quality')
    expect(byName.get('Quality Qi')).toBe('low_volume_high_quality')
    expect(byName.get('Middle Ma')).toBe('high_volume_high_quality')
  })

  test('excludes agents with no customers so they cannot drag the medians to zero', () => {
    const model = buildScatterModel([
      agentRow({ agent_user_id: 1, customer_count: 0, revenue: 0 }),
      agentRow({ agent_user_id: 2, customer_count: 10, revenue: 1_000 }),
      agentRow({ agent_user_id: 3, customer_count: 30, revenue: 9_000 }),
    ])

    expect(model.points.map((point) => point.agent_user_id)).toEqual([2, 3])
    expect(model.customers_median).toBe(20)
    expect(model.avg_revenue_median).toBe(200)
  })

  test('returns empty points and zero guides when there are no agents at all', () => {
    const model = buildScatterModel([])

    expect(model).toEqual({
      points: [],
      customers_median: 0,
      avg_revenue_median: 0,
    })
  })

  test('carries the paying rate and revenue onto each point for the tooltip', () => {
    const model = buildScatterModel([
      agentRow({
        agent_user_id: 7,
        customer_count: 20,
        paying_customer_count: 5,
        revenue: 4_000,
      }),
    ])

    expect(model.points[0].paying_rate).toBe(0.25)
    expect(model.points[0].revenue).toBe(4_000)
  })

  test('falls back to the username, then the id, when there is no display name', () => {
    const model = buildScatterModel([
      agentRow({
        agent_user_id: 1,
        display_name: '',
        username: 'agent_one',
        customer_count: 1,
      }),
      agentRow({
        agent_user_id: 2,
        display_name: '',
        username: '',
        customer_count: 1,
      }),
    ])

    expect(model.points.map((point) => point.label)).toEqual([
      'agent_one',
      '#2',
    ])
  })
})
