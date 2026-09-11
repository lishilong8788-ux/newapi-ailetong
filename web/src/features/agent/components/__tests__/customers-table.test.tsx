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

import type { AgentCustomer } from '../../types'

const navigate = vi.fn()
const useSearch = vi.fn(() => ({}) as Record<string, unknown>)

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch,
    useNavigate: () => navigate,
  }),
}))

const listAgentCustomers = vi.fn()
const getAgentOverview = vi.fn()
vi.mock('../../api', () => ({
  listAgentCustomers: (...args: unknown[]) => listAgentCustomers(...args),
  exportAgentCustomers: vi.fn(),
  getAgentOverview: () => getAgentOverview(),
}))

const { CustomersTable } = await import('../customers-table')
const { AgentProvider } = await import('../agent-provider')

const CUSTOMER: AgentCustomer = {
  id: 108,
  username: 'zhang_wei',
  display_name: 'Zhang Wei',
  created_at: 1_772_000_000,
  quota: 250_000,
  used_quota: 750_000,
  status: 1,
  topup_total: 1200,
  commission_total: 60,
}

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentProvider>
        <CustomersTable />
      </AgentProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useSearch.mockReturnValue({})
  getAgentOverview.mockResolvedValue({ success: false, message: '' })
  listAgentCustomers.mockResolvedValue({
    success: true,
    data: { items: [CUSTOMER], total: 1 },
  })
})

describe('agent customer columns', () => {
  test('lists the seven agreed columns in the designed order', async () => {
    const rendered = renderTable()

    await waitFor(() => {
      expect(screen.getByText('Zhang Wei')).toBeInTheDocument()
    })

    const labels = [
      ...rendered.container.querySelectorAll('[data-slot="table-header"] th'),
    ].map((cell) => cell.textContent)

    expect(labels).toEqual([
      'Customer',
      'Invited At',
      'Total Topup',
      'Remaining Quota',
      'Total Usage',
      'Total Commission',
      'Status',
    ])
  })

  test('reads the display name over the username, keeping both visible', async () => {
    renderTable()

    await waitFor(() => {
      expect(screen.getByText('Zhang Wei')).toBeInTheDocument()
    })
    expect(screen.getByText('zhang_wei')).toBeInTheDocument()
  })

  test('renders topup and commission as RMB, not as quota', async () => {
    const rendered = renderTable()

    await waitFor(() => {
      expect(screen.getByText('Zhang Wei')).toBeInTheDocument()
    })

    // Money columns are RMB decimals straight from the ledger; running them
    // through the quota formatter would rescale them by the quota-per-unit rate.
    const topup = rendered.container.querySelector(
      '[data-slot="table-body"] [data-column-id="topup_total"]'
    )
    const commission = rendered.container.querySelector(
      '[data-slot="table-body"] [data-column-id="commission_total"]'
    )
    expect(topup).toHaveTextContent('¥1,200.00')
    expect(commission).toHaveTextContent('¥60.00')
  })

  test('marks an enabled customer as enabled and a disabled one as disabled', async () => {
    listAgentCustomers.mockResolvedValue({
      success: true,
      data: {
        items: [
          CUSTOMER,
          {
            ...CUSTOMER,
            id: 109,
            username: 'li_na',
            display_name: '',
            status: 2,
          },
        ],
        total: 2,
      },
    })

    renderTable()

    await waitFor(() => {
      expect(screen.getByText('zhang_wei')).toBeInTheDocument()
    })
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })
})

describe('agent customer privacy boundary', () => {
  test('renders no contact detail even when the payload carries some', async () => {
    // An agent is an external partner, not staff (design doc §13.2). The
    // endpoint does not send contact details, and the table must not surface
    // them if a future payload starts to.
    listAgentCustomers.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            ...CUSTOMER,
            email: 'zhang.wei@example.test',
            phone: '13800000000',
          },
        ],
        total: 1,
      },
    })

    const rendered = renderTable()

    await waitFor(() => {
      expect(screen.getByText('Zhang Wei')).toBeInTheDocument()
    })

    expect(rendered.container.textContent).not.toContain('@example.test')
    expect(rendered.container.textContent).not.toContain('13800000000')

    const labels = [
      ...rendered.container.querySelectorAll('[data-slot="table-header"] th'),
    ].map((cell) => cell.textContent?.toLowerCase() ?? '')
    expect(labels.some((label) => label.includes('email'))).toBe(false)
    expect(labels.some((label) => label.includes('phone'))).toBe(false)
  })
})

describe('agent customer list states', () => {
  test('sends the page, page size and keyword the URL carries', async () => {
    useSearch.mockReturnValue({ page: 2, pageSize: 10, keyword: 'zhang' })

    renderTable()

    await waitFor(() => {
      expect(listAgentCustomers).toHaveBeenCalledWith({
        p: 2,
        page_size: 10,
        keyword: 'zhang',
      })
    })
  })

  test('falls back to the empty state when nobody has signed up yet', async () => {
    listAgentCustomers.mockResolvedValue({
      success: true,
      data: { items: [], total: 0 },
    })

    renderTable()

    expect(await screen.findByText('No Customers Yet')).toBeInTheDocument()
    expect(
      screen.getByText('Share your promo link to start inviting customers.')
    ).toBeInTheDocument()
  })
})
