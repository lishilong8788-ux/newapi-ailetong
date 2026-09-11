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

import { RANKING_LIMIT } from '../../constants'
import { buildCsvRow, buildRanking, CSV_HEADER_KEYS, toCsv } from '../analytics'
import { agentRow } from './fixtures'

describe('CSV row shaping', () => {
  test('emits one cell per header column', () => {
    expect(buildCsvRow(agentRow())).toHaveLength(CSV_HEADER_KEYS.length)
  })

  test('writes amounts and rates as bare numbers a spreadsheet can sum', () => {
    const row = buildCsvRow(
      agentRow({
        display_name: 'Acme Partners',
        username: 'acme',
        customer_count: 40,
        paying_customer_count: 10,
        revenue: 12_345.678,
        commission: 1_234.5,
        first_commission_time: 1_767_225_600, // 2026-01-01
        last_commission_time: 1_772_323_200, // 2026-03-01
        active_30d: 6,
      })
    )

    expect(row).toEqual([
      'Acme Partners',
      'acme',
      '40',
      '10',
      '0.2500',
      '12345.68',
      '308.64',
      '1234.50',
      '0.1000',
      '2026-01-01',
      '2026-03-01',
      '6',
    ])
  })

  test('leaves the timestamp cells empty for an agent that never earned', () => {
    const row = buildCsvRow(
      agentRow({ first_commission_time: 0, last_commission_time: 0 })
    )

    expect(row[9]).toBe('')
    expect(row[10]).toBe('')
  })

  test('writes zero rates rather than blanks for an agent with no customers', () => {
    const row = buildCsvRow(agentRow({ customer_count: 0, revenue: 0 }))

    expect(row[4]).toBe('0.0000')
    expect(row[6]).toBe('0.00')
    expect(row[8]).toBe('0.0000')
  })
})

describe('CSV serialization', () => {
  test('joins the header and rows with CRLF line endings', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['1', '2'],
          ['3', '4'],
        ]
      )
    ).toBe('a,b\r\n1,2\r\n3,4')
  })

  test('quotes a cell containing a comma so later columns do not shift', () => {
    expect(toCsv(['name'], [['Acme, Inc.']])).toBe('name\r\n"Acme, Inc."')
  })

  test('doubles inner quotes in a quoted cell', () => {
    expect(toCsv(['name'], [['The "Big" Agency']])).toBe(
      'name\r\n"The ""Big"" Agency"'
    )
  })

  test('quotes a cell containing a newline', () => {
    expect(toCsv(['name'], [['line1\nline2']])).toBe('name\r\n"line1\nline2"')
  })

  test('leaves an ordinary cell unquoted', () => {
    expect(toCsv(['name'], [['plain']])).toBe('name\r\nplain')
  })
})

describe('ranking', () => {
  const rows = [
    agentRow({
      agent_user_id: 1,
      display_name: 'A',
      revenue: 100,
      commission: 30,
      customer_count: 10,
      paying_customer_count: 1,
    }),
    agentRow({
      agent_user_id: 2,
      display_name: 'B',
      revenue: 300,
      commission: 10,
      customer_count: 4,
      paying_customer_count: 3,
    }),
    agentRow({
      agent_user_id: 3,
      display_name: 'C',
      revenue: 200,
      commission: 20,
      customer_count: 40,
      paying_customer_count: 2,
    }),
  ]

  test('orders by revenue descending', () => {
    expect(buildRanking(rows, 'revenue').map((entry) => entry.label)).toEqual([
      'B',
      'C',
      'A',
    ])
  })

  test('reorders when the metric changes to commission', () => {
    expect(
      buildRanking(rows, 'commission').map((entry) => entry.label)
    ).toEqual(['A', 'C', 'B'])
  })

  test('orders by customer count', () => {
    expect(buildRanking(rows, 'customers').map((entry) => entry.label)).toEqual(
      ['C', 'A', 'B']
    )
  })

  test('ranks paying rate as a fraction, not as a raw paying count', () => {
    // B converts 3 of 4 (75%) with the fewest customers, so a count-based sort
    // would rank it last while the rate ranks it first.
    const ranked = buildRanking(rows, 'paying_rate')

    expect(ranked.map((entry) => entry.label)).toEqual(['B', 'A', 'C'])
    expect(ranked[0].value).toBe(0.75)
  })

  test('drops zero-valued agents instead of drawing empty bars', () => {
    const ranked = buildRanking(
      [...rows, agentRow({ agent_user_id: 4, display_name: 'D', revenue: 0 })],
      'revenue'
    )

    expect(ranked.map((entry) => entry.label)).not.toContain('D')
  })

  test('breaks ties on agent id so the bar order is stable across refetches', () => {
    const ranked = buildRanking(
      [
        agentRow({ agent_user_id: 9, display_name: 'Nine', revenue: 500 }),
        agentRow({ agent_user_id: 2, display_name: 'Two', revenue: 500 }),
      ],
      'revenue'
    )

    expect(ranked.map((entry) => entry.label)).toEqual(['Two', 'Nine'])
  })

  test('caps the result at the top 20 by default', () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      agentRow({ agent_user_id: index + 1, revenue: index + 1 })
    )

    expect(buildRanking(many, 'revenue')).toHaveLength(RANKING_LIMIT)
  })

  test('honours an explicit smaller limit', () => {
    expect(buildRanking(rows, 'revenue', 2)).toHaveLength(2)
  })

  test('returns an empty ranking for an install with no agents', () => {
    expect(buildRanking([], 'revenue')).toEqual([])
  })
})
