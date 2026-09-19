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
import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { STATUS_QUERY_KEY, type StatusRecord } from '@/lib/status-query'

import type { AgentOverview } from '../types'

const useSearch = vi.fn(() => ({ page: 1, pageSize: 10, keyword: '' }))
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch,
    useNavigate: () => vi.fn(),
  }),
  Link: (props: { to: string; children?: ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

const getAgentOverview = vi.fn()
vi.mock('../api', () => ({
  getAgentOverview: () => getAgentOverview(),
  listAgentCustomers: vi.fn(() =>
    Promise.resolve({ success: true, data: { items: [], total: 0 } })
  ),
  exportAgentCustomers: vi.fn(),
}))

// The sign-up-reward card reads `/api/user/self`; only that one call is faked so
// the rest of the api module (the axios instance other imports pull in) is real.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getSelf: vi.fn(() => Promise.resolve({ success: true, data: {} })),
}))

const { Agent } = await import('..')

function renderAgentPage(status: StatusRecord) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(STATUS_QUERY_KEY, status)

  return render(
    <QueryClientProvider client={queryClient}>
      <Agent />
    </QueryClientProvider>
  )
}

describe('agent workbench when the programme is switched off', () => {
  test('explains the programme is off instead of loading the workbench', () => {
    renderAgentPage({ agent_enabled: false })

    expect(
      screen.getByText('The referral program is turned off')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute(
      'href',
      '/'
    )
  })

  test('does not request the overview it would only be refused', async () => {
    renderAgentPage({ agent_enabled: false })

    await waitFor(() => {
      expect(
        screen.getByText('The referral program is turned off')
      ).toBeInTheDocument()
    })
    expect(getAgentOverview).not.toHaveBeenCalled()
  })

  test('loads the referral page once the programme is on', async () => {
    getAgentOverview.mockResolvedValue({
      success: true,
      data: {
        profile: null,
        effective_rate: 0.05,
        stats: { available: 0, total: 0, withdrawn: 0, customer_count: 0 },
        withdrawal: { min_amount: 100, fee_rate: 0, can_apply: false },
        programme: { default_rate: 0.05, freeze_days: 7, auto_approve: false },
      } satisfies AgentOverview,
    })

    renderAgentPage({ agent_enabled: true })

    await waitFor(() => {
      expect(getAgentOverview).toHaveBeenCalled()
    })
    expect(
      screen.queryByText('The referral program is turned off')
    ).not.toBeInTheDocument()
  })
})
