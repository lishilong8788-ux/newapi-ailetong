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
  buildCostPricingRow,
  formatMarginRate,
  formatPricePair,
  formatUsdPerMillion,
  marginRateFromMarkupPercent,
  markupFractionToPercent,
  markupPercentToFraction,
  resolveMarkupPercent,
  summarizeCostPricingRows,
} from '../channel-cost-pricing'

describe('channel pricing arithmetic', () => {
  test('derives sell price, discount and margin from buy price and markup', () => {
    const row = buildCostPricingRow(
      { model: 'deepseek-v4.1', input: 0.49, output: 1.96 },
      30,
      { input: 1.99, output: 7.99 }
    )

    expect(row.markupPercent).toBe(30)
    expect(row.inheritsChannelMarkup).toBe(true)
    expect(row.hasOfficialPrice).toBe(true)
    // 0.49 × 1.3 and 1.96 × 1.3
    expect(row.input.sellPrice).toBeCloseTo(0.637, 6)
    expect(row.output.sellPrice).toBeCloseTo(2.548, 6)
    // sell ÷ official
    expect(row.input.discountFraction).toBeCloseTo(0.637 / 1.99, 6)
    expect(row.output.discountFraction).toBeCloseTo(2.548 / 7.99, 6)
    // margin over revenue reduces to markup / (1 + markup)
    expect(row.marginRate).toBeCloseTo(0.3 / 1.3, 6)
  })

  test('per-model markup overrides the channel markup for every column', () => {
    const row = buildCostPricingRow(
      { model: 'gpt-5', input: 1, output: 2, markupPercent: 50 },
      30,
      { input: 4, output: 8 }
    )

    expect(row.inheritsChannelMarkup).toBe(false)
    expect(row.markupPercent).toBe(50)
    expect(row.input.sellPrice).toBeCloseTo(1.5, 6)
    expect(row.output.sellPrice).toBeCloseTo(3, 6)
    expect(row.marginRate).toBeCloseTo(0.5 / 1.5, 6)
  })

  test('a 0 per-model markup sells at cost instead of falling back to the channel', () => {
    const row = buildCostPricingRow(
      { model: 'free-model', input: 2, markupPercent: 0 },
      30,
      undefined
    )

    expect(row.inheritsChannelMarkup).toBe(false)
    expect(row.markupPercent).toBe(0)
    expect(row.input.sellPrice).toBe(2)
    expect(row.marginRate).toBe(0)
  })

  test('a missing official price drops only the discount, not the sell price', () => {
    const row = buildCostPricingRow(
      { model: 'new-model', input: 1 },
      30,
      undefined
    )

    expect(row.hasOfficialPrice).toBe(false)
    expect(row.input.officialPrice).toBeNull()
    expect(row.input.sellPrice).toBeCloseTo(1.3, 6)
    expect(row.input.discountFraction).toBeNull()
    expect(row.marginRate).toBeCloseTo(0.3 / 1.3, 6)
  })

  test('a row with no buy price reports no sell price, discount or margin', () => {
    const row = buildCostPricingRow({ model: 'unpriced' }, 30, {
      input: 1.99,
      output: 7.99,
    })

    expect(row.input.sellPrice).toBeNull()
    expect(row.input.discountFraction).toBeNull()
    expect(row.output.sellPrice).toBeNull()
    // No cost means no margin claim: 30% here would be a price the channel
    // cannot charge.
    expect(row.marginRate).toBeNull()
  })
})

describe('markup resolution', () => {
  test.each([
    { row: 50, channel: 30, expected: 50, why: 'row override wins' },
    { row: 0, channel: 30, expected: 0, why: '0 is a real override' },
    { row: undefined, channel: 30, expected: 30, why: 'falls back to channel' },
    { row: -5, channel: 30, expected: 30, why: 'negative row is refused' },
    { row: undefined, channel: undefined, expected: 0, why: 'nothing set' },
    { row: Number.NaN, channel: 30, expected: 30, why: 'NaN is refused' },
  ])('$why', ({ row, channel, expected }) => {
    expect(resolveMarkupPercent(row, channel)).toBe(expected)
  })
})

describe('markup percent round-trip', () => {
  test.each([0, 0.5, 30, 33.33, 100, 1000])(
    '%s%% survives the fraction round-trip',
    (percent) => {
      expect(markupFractionToPercent(markupPercentToFraction(percent))).toBe(
        percent
      )
    }
  )

  test('percent is stored as a fraction', () => {
    expect(markupPercentToFraction(30)).toBe(0.3)
    expect(markupFractionToPercent(0.3)).toBe(30)
  })
})

describe('pricing cell formatting', () => {
  test('renders unknown prices and margins as a dash, not zero', () => {
    expect(formatUsdPerMillion(null)).toBe('-')
    expect(formatUsdPerMillion(Number.NaN)).toBe('-')
    expect(formatMarginRate(null)).toBe('-')
  })

  test('renders prices and margins at display precision', () => {
    expect(formatUsdPerMillion(0.637)).toBe('$0.637')
    expect(formatUsdPerMillion(2)).toBe('$2')
    expect(formatMarginRate(0.3 / 1.3)).toBe('23.1%')
    expect(formatMarginRate(0)).toBe('0%')
  })

  test('collapses the input/output pair only when both sides agree', () => {
    expect(formatPricePair('$1', '$1')).toBe('$1')
    expect(formatPricePair('$1', '$2')).toBe('$1 / $2')
    expect(formatPricePair('-', '-')).toBe('-')
  })
})

describe('markup restated as margin', () => {
  test('converts a markup percent into the margin the cost report reads', () => {
    // The pair the summary strip prints side by side: 30% markup is not a 30%
    // margin, and the two are routinely mistaken for each other.
    expect(formatMarginRate(marginRateFromMarkupPercent(30))).toBe('23.1%')
    expect(marginRateFromMarkupPercent(0)).toBe(0)
    expect(marginRateFromMarkupPercent(100)).toBe(0.5)
  })

  test('treats an absent or negative markup as no markup', () => {
    expect(marginRateFromMarkupPercent(undefined)).toBe(0)
    expect(marginRateFromMarkupPercent(Number.NaN)).toBe(0)
    expect(marginRateFromMarkupPercent(-10)).toBe(0)
  })
})

describe('pricing table summary', () => {
  const official = { input: 2, output: 8 }

  test('counts named, priced and overridden rows separately', () => {
    const summary = summarizeCostPricingRows([
      // Named and priced.
      buildCostPricingRow({ model: 'a', input: 1 }, 30, official),
      // Named, no buy price: it is on the table but will not bill.
      buildCostPricingRow({ model: 'b' }, 30, official),
      // Named, priced, and pricing off its own markup.
      buildCostPricingRow(
        { model: 'c', output: 4, markupPercent: 50 },
        30,
        official
      ),
      // A blank row the operator just added counts as nothing at all.
      buildCostPricingRow({ model: '' }, 30, undefined),
    ])

    expect(summary.namedCount).toBe(3)
    expect(summary.pricedCount).toBe(2)
    expect(summary.overriddenCount).toBe(1)
  })

  test('names models the official-price sync has never seen', () => {
    const summary = summarizeCostPricingRows([
      buildCostPricingRow({ model: 'a', input: 1 }, 30, official),
      buildCostPricingRow({ model: 'unsynced', input: 1 }, 30, undefined),
    ])

    expect(summary.modelsMissingOfficialPrice).toEqual(['unsynced'])
  })

  test('takes the median across every priced dimension, not the mean', () => {
    const summary = summarizeCostPricingRows([
      // 1 × 1.0 / 2 = 0.5 input.
      buildCostPricingRow(
        { model: 'a', input: 1, markupPercent: 0 },
        0,
        official
      ),
      // 2 / 8 = 0.25 output.
      buildCostPricingRow(
        { model: 'b', output: 2, markupPercent: 0 },
        0,
        official
      ),
      // An outlier at 5× list, which a mean would let drag the whole figure.
      buildCostPricingRow(
        { model: 'c', input: 10, markupPercent: 0 },
        0,
        official
      ),
    ])

    // Pool is [0.25, 0.5, 5]; the median is the middle one.
    expect(summary.medianDiscountFraction).toBe(0.5)
  })

  test('reports no median when nothing can be measured against a list price', () => {
    const summary = summarizeCostPricingRows([
      buildCostPricingRow({ model: 'a', input: 1 }, 30, undefined),
      buildCostPricingRow({ model: 'b' }, 30, official),
    ])

    expect(summary.medianDiscountFraction).toBeNull()
  })
})
