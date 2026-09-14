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

import type { PricingModel } from '../../types'
import { getPriceComparison } from '../price-comparison'

// The catalog's discount claim is "our price ÷ the vendor's published price".
// These tests pin that definition, because the previous one — our price ÷ our own
// price at group ratio 1 — produced a number that looked identical in the UI and
// meant something entirely different.

function buildModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'test-model',
    quota_type: 0,
    model_ratio: 0.96,
    completion_ratio: 5,
    enable_groups: ['default'],
    group_ratio: { default: 1 },
    ...overrides,
  }
}

const OPTIONS = { tokenUnit: 'M' as const }

describe('getPriceComparison official price comparison', () => {
  it('prices the official column from the official ratios', () => {
    const comparison = getPriceComparison(
      buildModel({
        official_model_ratio: 7.5,
        official_completion_ratio: 5,
        official_cache_ratio: 0.1,
        cache_ratio: 0.1,
      }),
      OPTIONS
    )

    // ratio 1 == $2 / 1M tokens, so 0.96 -> $1.92 and 7.5 -> $15.
    const input = comparison.rows.find((row) => row.key === 'input')
    expect(input?.platform).toBe('$1.92')
    expect(input?.official).toBe('$15')
    // 1.92 / 15 = 0.128, rounded to 0.13 so the label reads "1.3折" rather than
    // "1.28折".
    expect(input?.discountRatio).toBe(0.13)

    const output = comparison.rows.find((row) => row.key === 'output')
    expect(output?.platform).toBe('$9.6')
    expect(output?.official).toBe('$75')

    expect(comparison.hasOfficialPrice).toBe(true)
    expect(comparison.officialDiscountRatio).toBe(0.13)
  })

  it('reports no comparison when the model has no official price', () => {
    const comparison = getPriceComparison(buildModel(), OPTIONS)

    expect(comparison.hasOfficialPrice).toBe(false)
    expect(comparison.officialDiscountRatio).toBeNull()
    for (const row of comparison.rows) {
      expect(row.official).toBe('-')
      expect(row.discountRatio).toBeNull()
    }
  })

  it('does not claim a discount when the platform price is not below official', () => {
    const comparison = getPriceComparison(
      buildModel({ model_ratio: 10, official_model_ratio: 7.5 }),
      OPTIONS
    )

    const input = comparison.rows.find((row) => row.key === 'input')
    // The official price is still shown — it is a real number and the reader can
    // compare it — but there is no discount to label.
    expect(input?.official).toBe('$15')
    expect(input?.discountRatio).toBeNull()
    expect(comparison.officialDiscountRatio).toBeNull()
  })

  it('leaves a row unpriced when the vendor published no rate for it', () => {
    const comparison = getPriceComparison(
      buildModel({
        cache_ratio: 0.1,
        official_model_ratio: 7.5,
        // No official completion or cache ratio: those rows have nothing to
        // compare against, and must not fall back to the platform multipliers.
      }),
      OPTIONS
    )

    expect(comparison.rows.find((row) => row.key === 'input')?.official).toBe(
      '$15'
    )
    const output = comparison.rows.find((row) => row.key === 'output')
    expect(output?.official).toBe('-')
    expect(output?.discountRatio).toBeNull()
    const cache = comparison.rows.find((row) => row.key === 'cache')
    expect(cache?.official).toBe('-')
    expect(cache?.discountRatio).toBeNull()
    // The input row still carries a comparison, so the columns stay visible.
    expect(comparison.hasOfficialPrice).toBe(true)
  })

  it('takes the headline discount from the input row only', () => {
    // Input matches the official price, output undercuts it. Rows genuinely
    // disagree (live data has a model at 3.8折 input / 6.0折 output), so the badge
    // must not fall through to output and contradict the row the reader sees
    // first.
    const comparison = getPriceComparison(
      buildModel({
        model_ratio: 7.5,
        completion_ratio: 2,
        official_model_ratio: 7.5,
        official_completion_ratio: 5,
      }),
      OPTIONS
    )

    expect(
      comparison.rows.find((row) => row.key === 'input')?.discountRatio
    ).toBeNull()
    expect(
      comparison.rows.find((row) => row.key === 'output')?.discountRatio
    ).toBe(0.4)
    expect(comparison.officialDiscountRatio).toBeNull()
  })

  it('keeps the group ratio separate from the discount', () => {
    const comparison = getPriceComparison(
      buildModel({
        group_ratio: { default: 0.5 },
        official_model_ratio: 7.5,
        official_completion_ratio: 5,
      }),
      OPTIONS
    )

    // The group ratio is still reported for group badges, and it still halves the
    // platform price, but it is not itself the discount.
    expect(comparison.ratio).toBe(0.5)
    expect(comparison.hasDiscount).toBe(true)
    const input = comparison.rows.find((row) => row.key === 'input')
    expect(input?.platform).toBe('$0.96')
    // 0.96 / 15 = 0.064 -> 0.06, not the 0.5 the group ratio would have claimed.
    expect(input?.discountRatio).toBe(0.06)
  })

  it('compares a tiered-expression price against the flat official price', () => {
    const comparison = getPriceComparison(
      buildModel({
        billing_mode: 'tiered_expr',
        // Expression coefficients are $/1M tokens: $1.92 in, $9.60 out.
        billing_expr: 'tier("standard", p * 1.92 + c * 9.6)',
        official_model_ratio: 7.5,
        official_completion_ratio: 5,
      }),
      OPTIONS
    )

    const input = comparison.rows.find((row) => row.key === 'inputPrice')
    expect(input?.platform).toBe('$1.92')
    expect(input?.official).toBe('$15')
    expect(input?.discountRatio).toBe(0.13)
    expect(comparison.hasOfficialPrice).toBe(true)
  })

  it('has no official comparison for per-request models', () => {
    const comparison = getPriceComparison(
      buildModel({
        quota_type: 1,
        model_price: 0.5,
        official_model_ratio: 7.5,
      }),
      OPTIONS
    )

    expect(comparison.isPerRequest).toBe(true)
    expect(comparison.rows).toHaveLength(1)
    expect(comparison.rows[0].official).toBe('-')
    expect(comparison.hasOfficialPrice).toBe(false)
  })
})
