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
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

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

    expect(screen.getAllByText('Stability')).toHaveLength(2)
    // The card names neither the line nor its supplier type. The line names are
    // printed once by the automatic-routing card above, in this same order, and
    // the category is identical for every row of one model — both repeated down
    // the column without helping the reader choose between them.
    expect(screen.queryByText(/hs4/)).not.toBeInTheDocument()
    expect(screen.queryByText(/#9/)).not.toBeInTheDocument()
    expect(screen.queryByText('Public cloud')).not.toBeInTheDocument()
    expect(screen.queryByText('Model vendor')).not.toBeInTheDocument()

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

  test('shows the discount without spending a column on the official price', () => {
    // The left column is ~330px wide and stacks one of these per channel, so it
    // prints the channel price and the discount only. The official price lives
    // in the detail pane for the selected channel.
    render(
      <ChannelPriceCards
        model={buildModel({ official_model_ratio: 2 })}
        routes={[
          buildRoute({
            price: { price_source: 'channel', model_ratio: 0.5, discount: 0.5 },
          }),
        ]}
        priceRate={1}
        usdExchangeRate={1}
        tokenUnit='M'
      />
    )

    // $1/M against the vendor's $4/M.
    expect(screen.getByText('$1')).toBeInTheDocument()
    expect(screen.getByText('75% off')).toBeInTheDocument()
    expect(screen.getByText('Channel price/M')).toBeInTheDocument()
    expect(screen.queryByText('Official price/M')).not.toBeInTheDocument()
    expect(screen.queryByText('$4')).not.toBeInTheDocument()
  })

  test('fires onSelectChannel when a card is clicked', () => {
    const handleSelect = vi.fn()
    render(
      <ChannelPriceCards
        model={buildModel()}
        routes={[buildRoute({ channel_id: 42, code: 'yd6' })]}
        priceRate={1}
        usdExchangeRate={1}
        tokenUnit='M'
        onSelectChannel={handleSelect}
      />
    )

    fireEvent.click(screen.getByText('Stability'))
    expect(handleSelect).toHaveBeenCalledWith(42)
  })

  test('shows measured availability and first-token time, not the API docs button', () => {
    renderCards([
      buildRoute({ channel_id: 3, availability_pct: 99.76, ttft_ms: 840 }),
    ])

    expect(screen.getByText('99.76%')).toBeInTheDocument()
    expect(screen.getByText('840ms')).toBeInTheDocument()
    // Both figures need a name on them. Five bars and a bare duration leave the
    // reader guessing which direction is good.
    // The test i18n mock echoes keys back, so these assert the key is rendered,
    // not its English copy.
    expect(screen.getByText('Stability')).toBeInTheDocument()
    expect(screen.getByText('First token short')).toBeInTheDocument()
    // The per-channel quickref lives in the detail pane; the button here only
    // ever repeated the card's own click.
    expect(screen.queryByText('API Docs')).not.toBeInTheDocument()
  })

  test('shows a borrowed group first-token time, marked', () => {
    renderCards([
      buildRoute({ channel_id: 9, ttft_ms: 1615, ttft_source: 'group' }),
    ])

    // The asterisk is its own span, so the badge's text spans several nodes and
    // no single element matches "1.62s" exactly.
    expect(
      screen.getByText('First token short').parentElement
    ).toHaveTextContent('1.61s')
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  test('marks a borrowed group figure instead of passing it off as the channel’s own', () => {
    renderCards([
      buildRoute({
        channel_id: 7,
        availability_pct: 99.42,
        availability_source: 'group',
      }),
    ])

    expect(screen.getByText('99.42%')).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  test('leaves a channel’s own measurement unmarked', () => {
    renderCards([
      buildRoute({
        channel_id: 8,
        availability_pct: 99.42,
        availability_source: 'channel',
      }),
    ])

    expect(screen.getByText('99.42%')).toBeInTheDocument()
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })

  test('says why availability is blank rather than printing a bare dash', () => {
    // A channel nobody has called yet has no availability to report. Printing
    // 100% would turn absence of evidence into a recommendation, 0% would accuse
    // a working line of being broken, and a lone dash beside grey bars reads as
    // a broken widget.
    renderCards([buildRoute({ channel_id: 4 })])

    expect(screen.getByText('Not measured yet')).toBeInTheDocument()
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  test('falls back to the channel test round trip when no first token is measured', () => {
    // Every install starts with an empty channel metrics table while
    // channels.response_time is usually already populated. Showing nothing in
    // that slot tells the reader less than the weaker number does.
    renderCards([buildRoute({ channel_id: 6, latency_ms: 3930 })])

    expect(screen.getByText('3.93s')).toBeInTheDocument()
    expect(screen.queryByText('First token short')).not.toBeInTheDocument()
  })

  test('prefers measured first-token time over the test round trip', () => {
    renderCards([buildRoute({ channel_id: 6, ttft_ms: 840, latency_ms: 3930 })])

    expect(screen.getByText('840ms')).toBeInTheDocument()
    expect(screen.getByText('First token short')).toBeInTheDocument()
    expect(screen.queryByText('3.93s')).not.toBeInTheDocument()
  })

  test('distinguishes a fully failing channel from an unmeasured one', () => {
    renderCards([buildRoute({ channel_id: 5, availability_pct: 0 })])

    expect(screen.getByText('0.00%')).toBeInTheDocument()
  })

  test('applies highlight style when selectedChannelId matches', () => {
    const { container } = render(
      <ChannelPriceCards
        model={buildModel()}
        routes={[buildRoute({ channel_id: 10, code: 'ch10' })]}
        priceRate={1}
        usdExchangeRate={1}
        tokenUnit='M'
        selectedChannelId={10}
      />
    )

    const card = container.querySelector('.border-primary')
    expect(card).toBeInTheDocument()
  })
})

describe('AutoRouteCard', () => {
  test('omits the discount range when no channel has a discount', () => {
    render(
      <AutoRouteCard routes={[buildRoute(), buildRoute({ channel_id: 2 })]} />
    )

    expect(screen.getByText('Auto smart routing')).toBeInTheDocument()
    expect(screen.queryByText(/% off/)).not.toBeInTheDocument()
  })

  test('names every participating line and sizes the routing pool', () => {
    // The cards below no longer print the line names, so this card is the only
    // place a reader can see which lines a bare model name can reach.
    render(
      <AutoRouteCard
        routes={[buildRoute({ code: 'hs4' }), buildRoute({ channel_id: 2 })]}
      />
    )

    expect(screen.getByText('hs4')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('2 channels')).toBeInTheDocument()
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
            price: {
              price_source: 'channel',
              model_ratio: 0.044,
              discount: 0.44,
            },
          }),
        ]}
        autoRoute={{ enabled: true, mode: 'lowest_price', ranked: true }}
      />
    )

    expect(
      screen.getByText(/prefer the lowest-priced channel/)
    ).toBeInTheDocument()
  })

  test('fires onSelect and shows active ring when selected', () => {
    const handleSelect = vi.fn()
    const { container } = render(
      <AutoRouteCard
        routes={[buildRoute()]}
        selected
        onSelect={handleSelect}
      />
    )

    const card = container.querySelector('.border-primary')
    expect(card).toBeInTheDocument()

    fireEvent.click(screen.getByText('Auto smart routing'))
    expect(handleSelect).toHaveBeenCalledTimes(1)
  })
})
