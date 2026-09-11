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

import { SECONDS_PER_DAY } from '../../constants'
import { countDormant, hasNeverEarned, isDormant } from '../analytics'
import { agentRow, NOW } from './fixtures'

const daysAgo = (days: number) => NOW - days * SECONDS_PER_DAY

describe('dormancy threshold', () => {
  test('does not flag an agent whose last commission is inside the 60-day window', () => {
    expect(isDormant(daysAgo(59), NOW)).toBe(false)
  })

  test('does not flag an agent exactly at the 60-day boundary', () => {
    // The rule is "more than 60 days", so the boundary day itself still counts
    // as active and does not enter the follow-up list.
    expect(isDormant(daysAgo(60), NOW)).toBe(false)
  })

  test('flags an agent one day past the threshold', () => {
    expect(isDormant(daysAgo(61), NOW)).toBe(true)
  })

  test('does not flag an agent that has never earned a commission', () => {
    // Never having started is an onboarding problem, not a re-activation one.
    expect(isDormant(0, NOW)).toBe(false)
  })

  test('does not flag a future timestamp from a clock-skewed upstream', () => {
    expect(isDormant(NOW + SECONDS_PER_DAY, NOW)).toBe(false)
  })

  test('honours a caller-supplied threshold', () => {
    expect(isDormant(daysAgo(20), NOW, 14)).toBe(true)
    expect(isDormant(daysAgo(20), NOW, 30)).toBe(false)
  })
})

describe('never-earned detection', () => {
  test('reports an agent with no commission timestamp', () => {
    expect(hasNeverEarned(agentRow({ last_commission_time: 0 }))).toBe(true)
  })

  test('does not report an agent that has earned once', () => {
    expect(
      hasNeverEarned(agentRow({ last_commission_time: daysAgo(400) }))
    ).toBe(false)
  })
})

describe('dormant counting', () => {
  test('counts only the agents past the threshold', () => {
    const count = countDormant(
      [
        agentRow({ agent_user_id: 1, last_commission_time: daysAgo(5) }),
        agentRow({ agent_user_id: 2, last_commission_time: daysAgo(90) }),
        agentRow({ agent_user_id: 3, last_commission_time: daysAgo(120) }),
        agentRow({ agent_user_id: 4, last_commission_time: 0 }),
      ],
      NOW
    )

    expect(count).toBe(2)
  })

  test('counts zero for an install with no agents', () => {
    expect(countDormant([], NOW)).toBe(0)
  })
})
