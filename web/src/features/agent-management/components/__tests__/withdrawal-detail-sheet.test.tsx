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
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { AgentWithdrawal, WithdrawalDetail } from '../../types'

const getWithdrawal = vi.fn()

vi.mock('../../api', () => ({
  getWithdrawal: (...args: unknown[]) => getWithdrawal(...args),
}))

const { WithdrawalDetailSheet } = await import('../withdrawal-detail-sheet')
const { AgentsProvider, useAgents } = await import('../agents-provider')

const WITHDRAWAL: AgentWithdrawal = {
  id: 41,
  agent_user_id: 88,
  username: 'north-reseller',
  display_name: 'North Reseller',
  amount: 300,
  fee: 0,
  actual_amount: 300,
  method: 'bank',
  status: 'approved',
  pay_voucher: '',
  reject_reason: '',
  create_time: 1_772_000_000,
  audit_time: 1_772_100_000,
  pay_time: 0,
  audit_by: 3,
}

const DETAIL: WithdrawalDetail = {
  withdrawal: WITHDRAWAL,
  profile_snapshot: {
    agent_type: 'company',
    company_name: 'Northbound Tech Ltd.',
    bank_name: 'ICBC Shanghai',
    // The detail endpoint is the one surface that returns this in full.
    bank_account: '6222021234567890123',
    bank_branch: 'Pudong Sub-branch',
    contact_name: 'Wei Zhang',
    contact_phone: '13800000000',
  },
  commissions: [
    {
      id: 501,
      from_user_id: 9001,
      from_username: 'customer-a',
      source_type: 'topup',
      source_id: 70001,
      base_amount: 4000,
      rate: 0.05,
      amount: 200,
      create_time: 1_771_900_000,
    },
    {
      id: 502,
      from_user_id: 9002,
      from_username: 'customer-b',
      source_type: 'topup',
      source_id: 70002,
      base_amount: 2000,
      rate: 0.05,
      amount: 100,
      create_time: 1_771_950_000,
    },
  ],
}

function OpenDetailSheet() {
  const { setOpen, setCurrentWithdrawal } = useAgents()
  return (
    <button
      type='button'
      onClick={() => {
        setCurrentWithdrawal(WITHDRAWAL)
        setOpen('withdrawal-detail')
      }}
    >
      open
    </button>
  )
}

async function openSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <AgentsProvider>
        <OpenDetailSheet />
        <WithdrawalDetailSheet />
      </AgentsProvider>
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'open' }))
}

beforeEach(() => {
  getWithdrawal.mockResolvedValue({ success: true, data: DETAIL })
})

describe('withdrawal funds source breakdown', () => {
  test('lists the customer and order behind every claimed commission row', async () => {
    await openSheet()

    expect(
      await screen.findByText('2 commission record(s)')
    ).toBeInTheDocument()
    // Finance has to be able to name the source of the money before paying.
    expect(screen.getByText('customer-a (#9001)')).toBeInTheDocument()
    expect(screen.getByText('customer-b (#9002)')).toBeInTheDocument()
    expect(screen.getByText(/Top-up · #70001/)).toBeInTheDocument()
    expect(screen.getByText(/Top-up · #70002/)).toBeInTheDocument()
    expect(screen.getByText(/Base ¥4,000\.00 × 5%/)).toBeInTheDocument()
  })

  test('totals the claimed rows so the request amount can be checked', async () => {
    await openSheet()

    const totalLabel = await screen.findByText('Claimed total')
    // Scoped to its own row: the same figure also appears as Requested and Net
    // Payout, and the point here is that the lines sum to it.
    expect(totalLabel.parentElement).toHaveTextContent('¥300.00')
    // They do sum, so no reconciliation warning belongs on screen.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('flags a shortfall when the claimed rows do not add up to the request', async () => {
    getWithdrawal.mockResolvedValue({
      success: true,
      data: {
        ...DETAIL,
        commissions: [DETAIL.commissions[0]],
      },
    })

    await openSheet()

    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent(
      'The claimed records total ¥200.00 but the request is for ¥300.00. Do not pay until this is reconciled.'
    )
  })

  test('says so when no commission rows are attached at all', async () => {
    getWithdrawal.mockResolvedValue({
      success: true,
      data: { ...DETAIL, commissions: [] },
    })

    await openSheet()

    expect(
      await screen.findByText(
        'No commission records are attached to this withdrawal.'
      )
    ).toBeInTheDocument()
  })
})

describe('withdrawal payee details', () => {
  test('shows the full bank account, because this is the surface that pays it', async () => {
    await openSheet()

    expect(await screen.findByText('6222021234567890123')).toBeInTheDocument()
    expect(screen.getByLabelText('Copy bank account')).toBeInTheDocument()
    expect(screen.getByText('Northbound Tech Ltd.')).toBeInTheDocument()
  })

  test('reads as not provided rather than blank when the snapshot has no account', async () => {
    getWithdrawal.mockResolvedValue({
      success: true,
      data: {
        ...DETAIL,
        profile_snapshot: { ...DETAIL.profile_snapshot, bank_account: '' },
      },
    })

    await openSheet()

    // An empty cell would read as "nothing to see"; finance needs to know the
    // payout cannot be made yet.
    expect(await screen.findByText('Not provided')).toBeInTheDocument()
    expect(screen.queryByLabelText('Copy bank account')).not.toBeInTheDocument()
  })

  test('omits the payee snapshot entirely for a balance transfer', async () => {
    getWithdrawal.mockResolvedValue({
      success: true,
      data: {
        ...DETAIL,
        withdrawal: { ...WITHDRAWAL, method: 'balance' as const },
      },
    })

    await openSheet()

    // No money leaves the platform, so there is no account number to display.
    expect(await screen.findByText('Claimed total')).toBeInTheDocument()
    expect(screen.queryByText('Payee Snapshot')).not.toBeInTheDocument()
    expect(screen.queryByText('6222021234567890123')).not.toBeInTheDocument()
  })
})
