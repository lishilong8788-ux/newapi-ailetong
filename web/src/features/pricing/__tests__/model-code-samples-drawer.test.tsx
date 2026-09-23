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
import { describe, expect, test, vi } from 'vitest'

import type { ChannelRoute, PricingModel } from '../types'

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: { server_address: 'https://api.example.test' },
    loading: false,
    error: null,
  }),
}))

const { ModelCodeSamplesDrawer } =
  await import('../components/model-code-samples-drawer')

const MODEL: PricingModel = {
  id: 1,
  model_name: 'glm-5.2',
  quota_type: 0,
  model_ratio: 0.1,
  completion_ratio: 6,
  enable_groups: ['default'],
  supported_endpoint_types: ['openai'],
}

const ENDPOINT_MAP = {
  openai: { path: '/v1/chat/completions', method: 'POST' },
}

function route(channelId: number, code?: string): ChannelRoute {
  return {
    channel_id: channelId,
    code,
    category: 'vendor',
    price: { price_source: code ? 'channel' : 'fallback', model_ratio: 0.1 },
  }
}

function renderDrawer(lineCode?: string, routes: ChannelRoute[] = []) {
  return render(
    <ModelCodeSamplesDrawer
      open
      onOpenChange={() => undefined}
      model={MODEL}
      endpointMap={ENDPOINT_MAP}
      routes={routes}
      lineCode={lineCode}
    />
  )
}

describe('ModelCodeSamplesDrawer', () => {
  // The whole reason the samples moved out of a tab and into a drawer opened
  // *from* a channel's price pane: they have to be written for the line the
  // reader was looking at. `<model>/<code>` is what the distributor parses back
  // into a pin (model.SplitModelLineCode), so a sample built from the bare name
  // would quote one channel's prices and call another's.
  test('writes the samples for the line it was opened on', () => {
    renderDrawer('hs10', [route(1, 'hs10'), route(2, 'tx8')])

    expect(screen.getByText(/"model": "glm-5\.2\/hs10"/)).toBeInTheDocument()
  })

  test('falls back to the bare model name under automatic routing', () => {
    renderDrawer(undefined, [route(1, 'hs10')])

    expect(screen.getByText(/"model": "glm-5\.2"/)).toBeInTheDocument()
  })

  // A channel with no line code cannot be named in a request at all, so offering
  // it in the picker would hand the reader a string that resolves to nothing.
  test('offers only lines that publish a code, plus automatic routing', () => {
    renderDrawer('hs10', [route(1, 'hs10'), route(2), route(3, 'tx8')])

    const chips = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter(
        (label) =>
          label?.startsWith('Automatic routing') || label?.includes('glm-5.2/')
      )

    expect(chips).toEqual([
      'Automatic routingglm-5.2',
      'hs10glm-5.2/hs10',
      'tx8glm-5.2/tx8',
    ])
  })

  test('renders no picker when no line publishes a code', () => {
    renderDrawer(undefined, [route(1), route(2)])

    expect(screen.queryByText('Line')).not.toBeInTheDocument()
  })
})
