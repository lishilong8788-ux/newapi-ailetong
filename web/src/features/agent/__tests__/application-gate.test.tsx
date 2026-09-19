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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'

import type { AgentOverview, AgentProfile, AgentStatus } from '../types'

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

const PROMO_LINK = 'https://example.test/r/2dfZb4'

function buildProfile(status: AgentStatus): AgentProfile {
  return {
    id: 1,
    user_id: 42,
    agent_type: 'personal',
    status,
    level: '',
    commission_rate: null,
    subject_name: 'Li Si',
    id_no: '',
    company_name: '',
    tax_no: '',
    bank_name: '',
    bank_account: '',
    bank_branch: '',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    reject_reason: '',
    approved_at: 0,
    created_at: 1_772_000_000,
    updated_at: 1_772_000_000,
  }
}

/**
 * The overview as the server sends it: promotion material exists only from
 * `active` onwards, which is the gate under test.
 */
function buildOverview(profile: AgentProfile | null): AgentOverview {
  const isApproved =
    profile?.status === 'active' || profile?.status === 'suspended'

  return {
    profile,
    effective_rate: 0.05,
    stats: { available: 0, total: 0, withdrawn: 0, customer_count: 0 },
    ...(isApproved
      ? {
          aff_code: '2dfZb4',
          promo_link: PROMO_LINK,
          register_link: 'https://example.test/register?aff=2dfZb4',
        }
      : {}),
    withdrawal: { min_amount: 100, fee_rate: 0, can_apply: isApproved },
    programme: { default_rate: 0.05, freeze_days: 7, auto_approve: false },
  }
}

function renderAgentPage(overview: AgentOverview) {
  getAgentOverview.mockResolvedValue({ success: true, data: overview })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(STATUS_QUERY_KEY, { agent_enabled: true })

  return render(
    <QueryClientProvider client={queryClient}>
      <Agent />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useSearch.mockReturnValue({ page: 1, pageSize: 10, keyword: '' })
})

describe('referral page when the overview cannot be loaded', () => {
  // A failed request leaves the profile unreadable, exactly like never having
  // applied. Falling through to the application screen would tell an approved
  // agent they are not an agent, so the page must say it does not know instead.
  test('offers a retry instead of the application form', async () => {
    getAgentOverview.mockResolvedValue({
      success: false,
      message: 'network down',
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(STATUS_QUERY_KEY, { agent_enabled: true })

    render(
      <QueryClientProvider client={queryClient}>
        <Agent />
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole('button', { name: 'Retry' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Apply Now' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Become an Agent' })
    ).not.toBeInTheDocument()
  })
})

describe('referral page before the review has passed', () => {
  test('offers the application and withholds the promo link when there is no profile', async () => {
    renderAgentPage(buildOverview(null))

    expect(
      await screen.findByRole('heading', { name: 'Become an Agent' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Apply Now' })
    ).toBeInTheDocument()

    // The gate: nothing on this screen may hand out a promotion link.
    expect(screen.queryByText(PROMO_LINK)).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(PROMO_LINK)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Promo Link')).not.toBeInTheDocument()
  })

  test('asks an operator-added agent to submit their details', async () => {
    renderAgentPage(buildOverview(buildProfile('incomplete')))

    expect(
      await screen.findByText('An operator added you as an agent')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Submit Details' })
    ).toBeInTheDocument()
    expect(screen.queryByDisplayValue(PROMO_LINK)).not.toBeInTheDocument()
  })

  test('reports the application as under review while it is pending', async () => {
    renderAgentPage(buildOverview(buildProfile('pending')))

    expect(
      await screen.findByText('Your application is under review')
    ).toBeInTheDocument()
    // The submitted subject is echoed back so the applicant can check it.
    expect(screen.getByText(/Li Si/)).toBeInTheDocument()
    expect(screen.queryByDisplayValue(PROMO_LINK)).not.toBeInTheDocument()
  })

  test('shows the operator reason and offers a resubmit when rejected', async () => {
    const profile = buildProfile('rejected')
    profile.reject_reason = 'The ID number does not match the name'

    renderAgentPage(buildOverview(profile))

    expect(
      await screen.findByText('The ID number does not match the name')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Resubmit Application' })
    ).toBeInTheDocument()
    expect(screen.queryByDisplayValue(PROMO_LINK)).not.toBeInTheDocument()
  })
})

describe('referral page once the review has passed', () => {
  test('opens the workbench and the promo link for an active agent', async () => {
    renderAgentPage(buildOverview(buildProfile('active')))

    expect(await screen.findByDisplayValue(PROMO_LINK)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Commission Earnings')).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('heading', { name: 'Become an Agent' })
    ).not.toBeInTheDocument()
  })
})
