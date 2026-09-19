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

const getSelf = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getSelf: () => getSelf(),
}))

const { LegacyRewardsCard } = await import('../legacy-rewards-card')

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <LegacyRewardsCard />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getSelf.mockResolvedValue({
    success: true,
    data: { aff_quota: 500_000, aff_history_quota: 1_500_000, aff_count: 3 },
  })
})

describe('sign-up reward card visibility', () => {
  test('offers the transfer when there is an unspent reward balance', async () => {
    renderCard()

    expect(
      await screen.findByRole('heading', { name: 'Sign-up Rewards' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Transfer to Balance' })
    ).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  test('stays hidden on a zero balance so it cannot be read as commission', async () => {
    getSelf.mockResolvedValue({
      success: true,
      data: { aff_quota: 0, aff_history_quota: 1_500_000, aff_count: 3 },
    })

    const rendered = renderCard()

    await waitFor(() => {
      expect(getSelf).toHaveBeenCalled()
    })
    expect(
      screen.queryByRole('heading', { name: 'Sign-up Rewards' })
    ).not.toBeInTheDocument()
    expect(rendered.container).toBeEmptyDOMElement()
  })
})
