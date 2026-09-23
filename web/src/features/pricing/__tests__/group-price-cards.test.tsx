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
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { GroupPriceCards } from '../components/group-price-cards'
import type { PricingModel } from '../types'

const getPerfMetrics = vi.hoisted(() => vi.fn())

vi.mock('@/features/performance-metrics/api', () => ({ getPerfMetrics }))

function buildModel(): PricingModel {
  return {
    id: 1,
    model_name: 'glm-5.3',
    quota_type: 0,
    model_ratio: 0.1,
    completion_ratio: 6,
    enable_groups: ['default'],
    group_ratio: { default: 2 },
  } as PricingModel
}

function renderCards() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <GroupPriceCards
        model={buildModel()}
        usableGroup={{ default: 'default' }}
        priceRate={1}
        usdExchangeRate={7}
        tokenUnit='M'
      />
    </QueryClientProvider>
  )
}

describe('GroupPriceCards health footer', () => {
  // The bug this pins: the group card showed avg_latency_ms (end-to-end) with no
  // label, directly below a channel row labelled "first token". Two different
  // measurements, both rendered as a bare duration, read as one metric
  // contradicting itself — the reader has no way to tell them apart.
  test('shows first-token time, matching the channel cards', async () => {
    getPerfMetrics.mockResolvedValue({
      data: {
        groups: [
          {
            group: 'default',
            success_rate: 100,
            avg_ttft_ms: 1503,
            avg_latency_ms: 3931,
          },
        ],
      },
    })

    renderCards()

    expect(await screen.findByText(/1\.50s/)).toBeInTheDocument()
    // End-to-end is still reachable, but only where it cannot be mistaken for
    // the headline number.
    expect(screen.queryByText('3.93s')).not.toBeInTheDocument()
  })
})

