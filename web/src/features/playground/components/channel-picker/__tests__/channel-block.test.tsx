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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// The network boundary, and the only thing stubbed here: the hook, the query
// client and the picker all run for real.
vi.mock('@/features/pricing/api', () => ({
  getModelChannelPricing: vi.fn(),
  getPricing: vi.fn(),
}))

import { getModelChannelPricing } from '@/features/pricing/api'

import { ChannelBlock } from '../channel-block'
import { buildRoute } from './fixtures'

function renderBlock(modelName = 'glm-5.2') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(['status'], { price: 1, usd_exchange_rate: 1 })

  return render(
    <QueryClientProvider client={queryClient}>
      <ChannelBlock modelName={modelName} canPin onChannelChange={vi.fn()} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('ChannelBlock', () => {
  test('renders nothing when the channel list cannot be fetched', async () => {
    // `/api/pricing/channels` is display-only — the relay routes automatically
    // without it — so a failure costs the sidebar this block rather than leaving
    // a broken panel wedged under the model list.
    vi.mocked(getModelChannelPricing).mockRejectedValue(new Error('boom'))

    const { container } = renderBlock()

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  test('renders nothing before a model is selected', () => {
    // The query is disabled without a model, so a header counting zero channels
    // would report the absence of a request as the absence of channels.
    const { container } = renderBlock('')

    expect(container).toBeEmptyDOMElement()
    expect(getModelChannelPricing).not.toHaveBeenCalled()
  })

  test('renders the fetched channels once they arrive', async () => {
    vi.mocked(getModelChannelPricing).mockResolvedValue({
      success: true,
      data: [buildRoute({ channel_id: 7, code: 'hs4' })],
      auto_route: { enabled: true, mode: 'lowest_price', ranked: false },
    })

    renderBlock()

    expect(await screen.findByText('hs4')).toBeInTheDocument()
    expect(screen.getByText('glm-5.2')).toBeInTheDocument()
  })
})
