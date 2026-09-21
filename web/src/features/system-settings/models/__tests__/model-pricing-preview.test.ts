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

import {
  buildPreviewRows,
  EMPTY_LANE_ENABLED,
  EMPTY_LANE_PRICES,
  PRICE_UNIT_PER_CALL,
  PRICE_UNIT_PER_SECOND,
} from '../model-pricing-core'
import {
  getPriceDetail,
  getPriceSummary,
  type ModelPricingSnapshot,
} from '../model-pricing-snapshots'

const t = (key: string, params?: Record<string, unknown>) => {
  if (params?.currency) {
    return `${key} (${params.currency})`
  }
  if (params?.seconds !== undefined && params?.total !== undefined) {
    return `Example: ${params.seconds}s costs ${params.total}`
  }
  return key
}

describe('buildPreviewRows currency symbol', () => {
  it('formats per-token preview with custom currency symbol', () => {
    const rows = buildPreviewRows(
      { name: 'test-model' },
      'per-token',
      '',
      '',
      '0.5',
      { ...EMPTY_LANE_PRICES, completion: '1.0' },
      { ...EMPTY_LANE_ENABLED, completion: true },
      t,
      PRICE_UNIT_PER_CALL,
      '¥'
    )

    const inputRow = rows.find((r) => r.key === 'inputPrice')
    expect(inputRow?.value).toBe('¥0.5')

    const completionRow = rows.find((r) => r.key === 'completion')
    expect(completionRow?.value).toBe('¥1.0')
  })

  it('formats fixed price preview with custom currency symbol', () => {
    const rows = buildPreviewRows(
      { name: 'test-model', price: '0.04' },
      'per-request',
      '',
      '',
      '',
      EMPTY_LANE_PRICES,
      EMPTY_LANE_ENABLED,
      t,
      PRICE_UNIT_PER_CALL,
      '¥'
    )

    const priceRow = rows.find((r) => r.key === 'price')
    expect(priceRow?.value).toBe('¥0.04 / per request')
  })

  it('formats per-second price preview with custom currency symbol', () => {
    const rows = buildPreviewRows(
      { name: 'test-video', price: '0.02' },
      'per-request',
      '',
      '',
      '',
      EMPTY_LANE_PRICES,
      EMPTY_LANE_ENABLED,
      t,
      PRICE_UNIT_PER_SECOND,
      '¥'
    )

    const priceRow = rows.find((r) => r.key === 'price')
    expect(priceRow?.value).toBe('¥0.02 / per second')

    const estimateRow = rows.find((r) => r.key === 'perSecondEstimate')
    expect(estimateRow?.value).toContain('¥0.1')
  })
})

describe('getPriceSummary and getPriceDetail currency symbol', () => {
  it('formats summary with ¥ symbol for per-token model', () => {
    const model: ModelPricingSnapshot = {
      name: 'test-token',
      ratio: '0.5',
      hasConflict: false,
    }

    const summary = getPriceSummary(model, t, '¥')
    expect(summary).toBe('Input ¥1')
  })

  it('formats summary with ¥ symbol for fixed-price model', () => {
    const model: ModelPricingSnapshot = {
      name: 'test-fixed',
      price: '0.04',
      billingMode: 'per-request',
      hasConflict: false,
    }

    const summary = getPriceSummary(model, t, '¥')
    expect(summary).toBe('¥0.04 / request')
  })

  it('formats detail with ¥ symbol for output/cache lanes', () => {
    const model: ModelPricingSnapshot = {
      name: 'test-lanes',
      ratio: '1',
      completionRatio: '2',
      cacheRatio: '0.5',
      hasConflict: false,
    }

    const detail = getPriceDetail(model, t, '¥')
    expect(detail).toContain('Output ¥4')
    expect(detail).toContain('Cache ¥1')
  })
})
