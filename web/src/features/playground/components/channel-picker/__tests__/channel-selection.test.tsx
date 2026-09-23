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
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { ChannelPicker } from '../channel-picker'
import { buildRoute, renderPicker } from './fixtures'

// Pinning is an admin privilege (`model.IsAdmin`, middleware/auth.go), while the
// figures themselves are public — the pricing page shows the same data to
// everyone. So the split is controls, not content.

const ROUTES = [
  buildRoute({ channel_id: 7, code: 'hs4', category: 'public_cloud' }),
  buildRoute({ channel_id: 19, category: 'self_hosted' }),
]

beforeEach(() => {
  window.localStorage.clear()
})

describe('ChannelPicker permissions', () => {
  test('gives a non-admin no button for a channel row', async () => {
    renderPicker({ canPin: false, routes: ROUTES })

    // The gauge inside each row is a tooltip trigger, so "no buttons at all" is
    // the wrong assertion — what must be absent is a control naming the line.
    expect(
      screen.queryByRole('button', { name: /hs4/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Automatic routing/ })
    ).not.toBeInTheDocument()
  })

  test('does not report a channel change when a non-admin clicks a row', async () => {
    const onChannelChange = renderPicker({ canPin: false, routes: ROUTES })

    await userEvent.click(screen.getByText('hs4'))

    expect(onChannelChange).not.toHaveBeenCalled()
  })

  test('tells a non-admin why the rows are inert', () => {
    renderPicker({ canPin: false, routes: ROUTES })

    expect(
      screen.getByText('Pinning a channel is available to administrators only.')
    ).toBeInTheDocument()
  })

  test('drops that note once the viewer can pin', () => {
    renderPicker({ canPin: true, routes: ROUTES })

    expect(
      screen.queryByText(
        'Pinning a channel is available to administrators only.'
      )
    ).not.toBeInTheDocument()
  })

  test('shows no selection state on a non-admin’s rows', () => {
    // `aria-pressed` on a row nobody can press would announce a control that is
    // not there.
    renderPicker({ canPin: false, routes: ROUTES, channelId: 7 })

    expect(
      screen.queryByRole('button', { pressed: true })
    ).not.toBeInTheDocument()
  })
})

describe('ChannelPicker selection', () => {
  test('reports the channel id when an admin picks a row', async () => {
    const onChannelChange = renderPicker({ canPin: true, routes: ROUTES })

    await userEvent.click(screen.getByRole('button', { name: /hs4/ }))

    expect(onChannelChange).toHaveBeenCalledWith(7)
  })

  test('reports undefined when an admin picks automatic routing', async () => {
    // Undefined is the wire value for "no pin", not a missing argument.
    const onChannelChange = renderPicker({
      canPin: true,
      routes: ROUTES,
      channelId: 7,
    })

    await userEvent.click(
      screen.getByRole('button', { name: /Automatic routing/ })
    )

    expect(onChannelChange).toHaveBeenCalledWith(undefined)
  })

  test('marks the pinned row as pressed and the auto row as not', () => {
    renderPicker({ canPin: true, routes: ROUTES, channelId: 19 })

    expect(screen.getByRole('button', { name: /#19/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      screen.getByRole('button', { name: /Automatic routing/ })
    ).toHaveAttribute('aria-pressed', 'false')
  })

  test('marks automatic routing as pressed while nothing is pinned', () => {
    renderPicker({ canPin: true, routes: ROUTES, channelId: undefined })

    expect(
      screen.getByRole('button', { name: /Automatic routing/ })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('selects a row by keyboard', async () => {
    // The rows are divs with `role="button"` because each contains a tooltip
    // trigger, so Enter and Space are handled by hand and have to be covered.
    const onChannelChange = renderPicker({ canPin: true, routes: ROUTES })

    screen.getByRole('button', { name: /hs4/ }).focus()
    await userEvent.keyboard('{Enter}')

    expect(onChannelChange).toHaveBeenCalledWith(7)
  })
})

describe('ChannelPicker routing policy copy', () => {
  test('promises cheapest-first only when the model has a ranked spread', () => {
    renderPicker({
      routes: ROUTES,
      autoRoute: { enabled: true, mode: 'lowest_price', ranked: true },
    })

    expect(
      screen.getByText('Cheapest first · switches on failure')
    ).toBeInTheDocument()
    expect(screen.getByText('Lowest price')).toBeInTheDocument()
  })

  test('describes operator order while the switch is on but nothing is ranked', () => {
    // The normal state until per-channel discounts exist: there is no price
    // spread to rank on, so promising price-first routing would be a lie.
    renderPicker({
      routes: ROUTES,
      autoRoute: { enabled: true, mode: 'lowest_price', ranked: false },
    })

    expect(
      screen.getByText('Operator order · switches on failure')
    ).toBeInTheDocument()
    expect(screen.queryByText('Lowest price')).not.toBeInTheDocument()
  })
})

describe('ChannelPicker states', () => {
  test('states that there are no channels rather than drawing an empty frame', () => {
    renderPicker({ routes: [] })

    expect(screen.getByText('No channels available')).toBeInTheDocument()
    expect(screen.queryByText('Automatic routing')).not.toBeInTheDocument()
  })

  test('shows skeletons instead of an empty-state claim while loading', () => {
    const { container } = render(
      <ChannelPicker
        modelName='glm-5.2'
        routes={[]}
        isLoading
        canPin
        onChannelChange={vi.fn()}
      />
    )

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    expect(screen.queryByText('No channels available')).not.toBeInTheDocument()
  })

  test('collapsing leaves the header and removes the rows', async () => {
    // The block competes with the model list for a fixed 288px column, so the
    // fold has to actually reclaim the height rather than just rotate a chevron.
    renderPicker({ canPin: true, routes: ROUTES })

    const toggle = screen.getByRole('button', { expanded: true })
    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('hs4')).not.toBeInTheDocument()
    expect(screen.queryByText('Automatic routing')).not.toBeInTheDocument()
    expect(screen.getByText('glm-5.2')).toBeInTheDocument()
  })

  test('restores a previously collapsed block on mount', () => {
    // Persisted because the block is a standing choice about how to spend the
    // column, not a per-visit one.
    window.localStorage.setItem('playground_channel_block_collapsed', '1')

    renderPicker({ canPin: true, routes: ROUTES })

    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
    expect(screen.queryByText('hs4')).not.toBeInTheDocument()
  })
})
