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

import type { Channel } from '@/features/channels/types'

import { resolveSupplyPricing } from '../supply-pricing'
import type { CatalogSupplyRow } from '../../types'

function makeRow(options: {
  settings?: string
  upstreamModel?: string
}): CatalogSupplyRow {
  const channel = {
    id: 1,
    type: 1,
    key: '',
    status: 1,
    name: 'line',
    created_time: 0,
    test_time: 0,
    response_time: 0,
    other: '',
    balance: 0,
    balance_updated_time: 0,
    models: 'gpt-4o',
    group: 'default',
    used_quota: 0,
    other_info: '',
    remark: '',
    max_input_tokens: 0,
    channel_info: {
      is_multi_key: false,
      multi_key_size: 0,
      multi_key_polling_index: 0,
      multi_key_mode: 'random',
    },
    settings: options.settings ?? '{}',
  } as Channel

  return {
    channel,
    upstreamModel: options.upstreamModel ?? 'gpt-4o',
    serving: true,
  }
}

const settingsWith = (cost: unknown) => JSON.stringify({ cost })

describe('resolveSupplyPricing', () => {
  it('reports unpriced when the channel has no cost config', () => {
    const pricing = resolveSupplyPricing(makeRow({}))

    expect(pricing.unpriced).toBe(true)
    expect(pricing.buyInput).toBeNull()
    expect(pricing.marginRate).toBeNull()
  })

  it('derives the sell price from the buy price and the channel markup', () => {
    const row = makeRow({
      settings: settingsWith({
        default_markup: 0.25,
        models: { 'gpt-4o': { input: 2, output: 8 } },
      }),
    })

    const pricing = resolveSupplyPricing(row)

    expect(pricing.buyInput).toBe(2)
    expect(pricing.sellInput).toBeCloseTo(2.5, 10)
    expect(pricing.sellOutput).toBeCloseTo(10, 10)
    expect(pricing.markupPercent).toBe(25)
  })

  it('prefers the per-model markup over the channel default', () => {
    const row = makeRow({
      settings: settingsWith({
        default_markup: 0.25,
        models: { 'gpt-4o': { input: 2, markup: 1 } },
      }),
    })

    const pricing = resolveSupplyPricing(row)

    expect(pricing.markupPercent).toBe(100)
    expect(pricing.hasModelMarkup).toBe(true)
    expect(pricing.sellInput).toBeCloseTo(4, 10)
  })

  it('reports margin as markup over one plus markup, not as the markup', () => {
    const row = makeRow({
      settings: settingsWith({
        default_markup: 0.3,
        models: { 'gpt-4o': { input: 1 } },
      }),
    })

    // A 30% markup is a 23.08% margin. The two are routinely confused, and the
    // cost report grades on the second.
    expect(resolveSupplyPricing(row).marginRate).toBeCloseTo(0.3 / 1.3, 6)
  })

  it('keeps a zero buy price as a price rather than as unset', () => {
    const row = makeRow({
      settings: settingsWith({
        default_markup: 0.5,
        models: { 'gpt-4o': { input: 0 } },
      }),
    })

    const pricing = resolveSupplyPricing(row)

    expect(pricing.unpriced).toBe(false)
    expect(pricing.buyInput).toBe(0)
    expect(pricing.sellInput).toBe(0)
  })

  it('reads the cost entry under the upstream name, not the client name', () => {
    const row = makeRow({
      upstreamModel: 'azure-gpt-4o',
      settings: settingsWith({
        models: { 'azure-gpt-4o': { input: 3 }, 'gpt-4o': { input: 99 } },
      }),
    })

    expect(resolveSupplyPricing(row).buyInput).toBe(3)
  })

  it('surfaces a per-request price and leaves the token prices unset', () => {
    const row = makeRow({
      settings: settingsWith({
        default_markup: 0.2,
        models: { 'gpt-4o': { per_call: 0.05 } },
      }),
    })

    const pricing = resolveSupplyPricing(row)

    expect(pricing.perCallBuy).toBe(0.05)
    expect(pricing.perCallSell).toBeCloseTo(0.06, 10)
    expect(pricing.buyInput).toBeNull()
  })

  it('treats a model priced only on a secondary kind as priced', () => {
    const row = makeRow({
      settings: settingsWith({
        default_markup: 0.1,
        models: { 'gpt-4o': { audio_in: 40 } },
      }),
    })

    const pricing = resolveSupplyPricing(row)

    expect(pricing.unpriced).toBe(false)
    expect(pricing.marginRate).toBeCloseTo(0.1 / 1.1, 6)
  })

  it('falls back to a zero markup when neither level configures one', () => {
    const row = makeRow({
      settings: settingsWith({ models: { 'gpt-4o': { input: 5 } } }),
    })

    const pricing = resolveSupplyPricing(row)

    expect(pricing.markupPercent).toBe(0)
    expect(pricing.sellInput).toBe(5)
    expect(pricing.marginRate).toBe(0)
  })
})
