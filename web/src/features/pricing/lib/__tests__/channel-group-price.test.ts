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
  toChannelGroupPricedModel,
  toChannelPricedModel,
} from '../channel-price'
import { getPriceComparison } from '../price-comparison'
import type { ChannelRoute, PricingModel } from '../../types'

// The two channel projections exist to answer two different questions, and the
// bug they guard against is using one where the other belongs: quoting a channel
// tier with a group multiplier already folded in, or quoting a group price that
// ignores which channel serves it.

const MODEL: PricingModel = {
  id: 1,
  model_name: 'glm-5.3-flash',
  quota_type: 0,
  model_ratio: 1,
  completion_ratio: 4,
  cache_ratio: 0.2,
  official_model_ratio: 1.25,
  enable_groups: ['default', 'vip'],
  group_ratio: { default: 0.9, vip: 0.6 },
}

const ROUTE: ChannelRoute = {
  channel_id: 3,
  category: 'aggregator',
  price: {
    price_source: 'channel',
    model_ratio: 0.8,
    completion_ratio: 4,
    cache_ratio: 0.2,
    discount: 0.8,
    upstream_model: 'glm-5.3-flash',
  },
}

function inputPrice(model: PricingModel, selectedGroup?: string): string {
  const comparison = getPriceComparison(model, {
    tokenUnit: 'M',
    priceRate: 1,
    usdExchangeRate: 1,
    selectedGroup,
  })
  const row = comparison.rows.find((r) => r.labelKey === 'Input')
  return row?.platform ?? ''
}

describe('channel price projections', () => {
  test('the channel tier itself carries no group multiplier', () => {
    const channelModel = toChannelPricedModel(MODEL, ROUTE)

    expect(channelModel.enable_groups).toEqual([])
    expect(channelModel.group_ratio).toEqual({})
    // Asking for a group by name cannot reintroduce the multiplier either: a
    // channel card must read as the channel's own rate no matter who is looking
    // at it.
    expect(inputPrice(channelModel, 'vip')).toBe(inputPrice(channelModel))
  })

  test('group prices scale the selected channel rate, not the catalog rate', () => {
    const groupModel = toChannelGroupPricedModel(MODEL, ROUTE)

    expect(groupModel.enable_groups).toEqual(['default', 'vip'])
    expect(groupModel.group_ratio).toEqual({ default: 0.9, vip: 0.6 })

    // Channel ratio 0.8 against the catalog's 1: every group card on this route
    // must land below the same card priced off the catalog.
    const catalogVip = inputPrice(MODEL, 'vip')
    const channelVip = inputPrice(groupModel, 'vip')
    expect(channelVip).not.toBe(catalogVip)
    expect(Number.parseFloat(channelVip.replaceAll(/[^\d.]/g, ''))).toBeCloseTo(
      Number.parseFloat(catalogVip.replaceAll(/[^\d.]/g, '')) * 0.8,
      4
    )
  })

  test('a cheaper group prices below a dearer one on the same channel', () => {
    const groupModel = toChannelGroupPricedModel(MODEL, ROUTE)
    const vip = Number.parseFloat(
      inputPrice(groupModel, 'vip').replaceAll(/[^\d.]/g, '')
    )
    const standard = Number.parseFloat(
      inputPrice(groupModel, 'default').replaceAll(/[^\d.]/g, '')
    )

    expect(vip).toBeLessThan(standard)
    // 0.6 vs 0.9 on the same channel rate.
    expect(vip / standard).toBeCloseTo(0.6 / 0.9, 4)
  })

  test('the official reference survives the projection, so discounts stay honest', () => {
    const groupModel = toChannelGroupPricedModel(MODEL, ROUTE)
    const comparison = getPriceComparison(groupModel, {
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      selectedGroup: 'vip',
    })

    expect(comparison.hasOfficialPrice).toBe(true)
    // Channel 0.8 × group 0.6 = 0.48 of the site's standard rate, against an
    // official ratio of 1.25: 0.48 / 1.25 = 0.384, which the comparison rounds
    // to two decimals so the label renders "3.8折" rather than "3.84折".
    expect(comparison.officialDiscountRatio).toBeCloseTo(0.38, 5)
  })
})
