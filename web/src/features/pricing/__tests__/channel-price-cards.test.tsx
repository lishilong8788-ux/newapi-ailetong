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
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { AutoRouteCard } from '../components/auto-route-card'
import { ChannelPriceCards } from '../components/channel-price-cards'
import type { ChannelRoute, PricingModel } from '../types'

// The state every fresh install is in — no channel has a sell discount yet — is
// the one most likely to render wrong, because every discount-shaped element has
// to disappear without taking the price rows with it. These tests pin that case
// alongside a real spread.

function buildModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'deepseek-v4-pro',
    quota_type: 0,
    model_ratio: 0.1,
    completion_ratio: 6,
    enable_groups: ['default'],
    group_ratio: { default: 2 },
    ...overrides,
  }
}

function buildRoute(overrides: Partial<ChannelRoute> = {}): ChannelRoute {
  return {
    channel_id: 1,
    category: 'aggregator',
    price: {
      price_source: 'fallback',
      model_ratio: 0.1,
      upstream_model: 'deepseek-v4-pro',
    },
    ...overrides,
  }
}

function renderCards(routes: ChannelRoute[]) {
  render(
    <ChannelPriceCards
      model={buildModel()}
      routes={routes}
      priceRate={1}
      usdExchangeRate={1}
      tokenUnit='M'
    />
  )
}

describe('ChannelPriceCards', () => {
  test('renders a card per channel with no discount configured anywhere', () => {
    renderCards([
      buildRoute({ channel_id: 7, category: 'public_cloud', code: 'hs4' }),
      buildRoute({ channel_id: 9, category: 'vendor' }),
    ])

    expect(screen.getByText(/hs4/)).toBeInTheDocument()
    expect(screen.getByText(/#9/)).toBeInTheDocument()
    expect(screen.getByText('Public cloud')).toBeInTheDocument()
    expect(screen.getByText('Model vendor')).toBeInTheDocument()

    // Nothing is cheapest when every row costs the same, so the badge that
    // would single one out must stay away.
    expect(screen.queryByText('Lowest price')).not.toBeInTheDocument()
  })

  test('badges the cheapest channel only when a row is genuinely dearer', () => {
    renderCards([
      buildRoute({
        channel_id: 1,
        code: 'a',
        price: { price_source: 'channel', model_ratio: 0.044, discount: 0.44 },
      }),
      buildRoute({
        channel_id: 2,
        code: 'b',
        price: { price_source: 'channel', model_ratio: 0.078, discount: 0.78 },
      }),
    ])

    expect(screen.getAllByText('Lowest price')).toHaveLength(1)
  })

  test('prices at group ratio 1 so the group multiplier is not applied twice', () => {
    // The model carries group_ratio 2. A channel tier is the supply-side price;
    // the reader's group multiplier is shown by the per-group cards above and
    // must not be folded in here as well.
    renderCards([
      buildRoute({
        price: { price_source: 'channel', model_ratio: 0.5, discount: 0.5 },
      }),
    ])

    // ratio 0.5 == $1/M at group ratio 1, $2/M if the group ratio leaked in.
    expect(screen.getByText('$1')).toBeInTheDocument()
    expect(screen.queryByText('$2')).not.toBeInTheDocument()
  })
})

describe('AutoRouteCard', () => {
  test('omits the discount range when no channel has a discount', () => {
    render(<AutoRouteCard routes={[buildRoute(), buildRoute({ channel_id: 2 })]} />)

    expect(screen.getByText('Automatic routing')).toBeInTheDocument()
    expect(screen.queryByText(/% off/)).not.toBeInTheDocument()
  })

  test('describes operator order while the switch is on but nothing is ranked', () => {
    render(
      <AutoRouteCard
        routes={[buildRoute()]}
        autoRoute={{ enabled: true, mode: 'lowest_price', ranked: false }}
      />
    )

    // Promising lowest-price routing here would describe an ordering the router
    // is not applying to this model.
    expect(
      screen.getByText(/in the order the operator configured/)
    ).toBeInTheDocument()
  })

  test('describes price preference once the model actually has a spread', () => {
    render(
      <AutoRouteCard
        routes={[
          buildRoute({
            price: { price_source: 'channel', model_ratio: 0.044, discount: 0.44 },
          }),
        ]}
        autoRoute={{ enabled: true, mode: 'lowest_price', ranked: true }}
      />
    )

    expect(
      screen.getByText(/prefer the lowest-priced channel/)
    ).toBeInTheDocument()
  })
})
