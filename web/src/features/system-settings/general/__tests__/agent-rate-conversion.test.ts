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
  commissionRateToPercent,
  percentToCommissionRate,
} from '../agent-settings-form'

describe('agent commission rate unit conversion', () => {
  test('renders a stored fraction as the matching percentage', () => {
    expect(commissionRateToPercent(0.05)).toBe(5)
    expect(commissionRateToPercent(0.3)).toBe(30)
    expect(commissionRateToPercent(0)).toBe(0)
    expect(commissionRateToPercent(1)).toBe(100)
  })

  test('stores a typed percentage as the matching fraction', () => {
    expect(percentToCommissionRate(5)).toBe(0.05)
    expect(percentToCommissionRate(30)).toBe(0.3)
    expect(percentToCommissionRate(0)).toBe(0)
    expect(percentToCommissionRate(100)).toBe(1)
  })

  test('round-trips every default without drifting off the stored value', () => {
    for (const rate of [0, 0.0025, 0.05, 0.075, 0.3, 0.999, 1]) {
      expect(percentToCommissionRate(commissionRateToPercent(rate))).toBe(rate)
    }
  })
})
