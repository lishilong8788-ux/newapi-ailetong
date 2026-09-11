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

import type { AgentListItem } from '../../types'

const navigate = vi.fn()
const useSearch = vi.fn(() => ({}) as Record<string, unknown>)

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch,
    useNavigate: () => navigate,
  }),
}))

const listAgentProfiles = vi.fn()
const exportAgentData = vi.fn()
vi.mock('../../api', () => ({
  listAgentProfiles: (...args: unknown[]) => listAgentProfiles(...args),
  exportAgentData: (...args: unknown[]) => exportAgentData(...args),
}))

const { AgentsTable } = await import('../agents-table')
const { AgentsProvider } = await import('../agents-provider')

const ACTIVE_AGENT: AgentListItem = {
  id: 5,
  user_id: 88,
  agent_type: 'company',
  // Active rather than pending: the row actions stay populated without the
  // audit buttons, and no Base UI menu is mounted either way.
  status: 'active',
  level: 'gold',
  commission_rate: 0.08,
  subject_name: '',
  id_no: '',
  company_name: 'Northbound Tech Ltd.',
  tax_no: '91310000MA1K35Q1XY',
  bank_name: 'ICBC Shanghai',
  // Already masked by the server, as the list endpoint always is.
  bank_account: '****0123',
  bank_branch: 'Pudong Sub-branch',
  contact_name: 'Wei Zhang',
  contact_phone: '13800000000',
  contact_email: 'wei@northbound.test',
  audit_by: 3,
  audit_time: 1_772_100_000,
  reject_reason: '',
  remark: '',
  created_at: 1_772_000_000,
  updated_at: 1_772_100_000,
  username: 'north-reseller',
  display_name: 'North Reseller',
  customer_count: 12,
  agent_commission_total: 4820.5,
  agent_commission_available: 1200,
  agent_withdrawn_total: 3620.5,
}

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentsProvider>
        <AgentsTable />
      </AgentsProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useSearch.mockReturnValue({})
  listAgentProfiles.mockResolvedValue({
    success: true,
    data: { items: [ACTIVE_AGENT], total: 1 },
  })
})

describe('agent list bank account masking', () => {
  test('never renders a full account number on the roster', async () => {
    renderTable()

    await waitFor(() => {
      expect(screen.getByText('north-reseller')).toBeInTheDocument()
    })

    // The roster is a browsing surface; only the withdrawal being paid shows a
    // payable number.
    expect(screen.getByText('••••0123')).toBeInTheDocument()
    expect(screen.queryByText('6222021234567890123')).not.toBeInTheDocument()
  })

  test('masks an unmasked account rather than trusting the payload', async () => {
    listAgentProfiles.mockResolvedValue({
      success: true,
      data: {
        items: [{ ...ACTIVE_AGENT, bank_account: '6222021234567890123' }],
        total: 1,
      },
    })

    renderTable()

    await waitFor(() => {
      expect(screen.getByText('north-reseller')).toBeInTheDocument()
    })

    expect(screen.getByText('••••0123')).toBeInTheDocument()
    expect(screen.queryByText('6222021234567890123')).not.toBeInTheDocument()
  })
})

describe('agent list money and rate columns', () => {
  test('renders commission as RMB currency, not quota', async () => {
    renderTable()

    await waitFor(() => {
      expect(screen.getByText('north-reseller')).toBeInTheDocument()
    })

    // Yuan decimals straight from the ledger. Routing these through the quota
    // formatter would divide by the quota rate and understate every figure.
    expect(screen.getByText('¥4,820.50')).toBeInTheDocument()
    expect(screen.getByText('¥1,200.00')).toBeInTheDocument()
    expect(screen.getByText('¥3,620.50')).toBeInTheDocument()
  })

  test('shows an explicit rate as a percentage', async () => {
    renderTable()

    await waitFor(() => {
      expect(screen.getByText('8%')).toBeInTheDocument()
    })
  })

  test('distinguishes "no override" from a zero rate', async () => {
    listAgentProfiles.mockResolvedValue({
      success: true,
      data: {
        items: [
          { ...ACTIVE_AGENT, commission_rate: null },
          {
            ...ACTIVE_AGENT,
            id: 6,
            user_id: 89,
            username: 'zero-rate',
            commission_rate: 0,
          },
        ],
        total: 2,
      },
    })

    renderTable()

    await waitFor(() => {
      expect(screen.getByText('Global default')).toBeInTheDocument()
    })
    // 0% pays nothing; following the default pays the platform rate. Collapsing
    // the two would silently change what an agent earns.
    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})

describe('agent list filtering', () => {
  test('sends the status filter from the URL to the API', async () => {
    useSearch.mockReturnValue({ status: ['pending'] })

    renderTable()

    await waitFor(() => {
      expect(listAgentProfiles).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' })
      )
    })
  })

  test('falls back to the icon empty state when nothing matches', async () => {
    listAgentProfiles.mockResolvedValue({
      success: true,
      data: { items: [], total: 0 },
    })

    renderTable()

    expect(await screen.findByText('No Agents Found')).toBeInTheDocument()
    expect(
      screen.getByText('No agents match the current filters.')
    ).toBeInTheDocument()
  })
})
