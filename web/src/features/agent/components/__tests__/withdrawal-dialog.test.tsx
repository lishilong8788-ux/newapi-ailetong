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
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { AgentOverview, AgentProfile } from '../../types'

const getAgentOverview = vi.fn()
const createAgentWithdrawal = vi.fn()
vi.mock('../../api', () => ({
  getAgentOverview: () => getAgentOverview(),
  createAgentWithdrawal: (...args: unknown[]) => createAgentWithdrawal(...args),
}))

const { WithdrawalDialog } = await import('../dialogs/withdrawal-dialog')
const { AgentProvider, useAgent } = await import('../agent-provider')

// Delayed keystrokes push this suite past its timeout when the whole test run
// executes in parallel; the fee/net computation under test is not timing
// dependent.
const user = userEvent.setup({ delay: null })

const BASE_PROFILE: AgentProfile = {
  id: 1,
  user_id: 42,
  agent_type: 'personal',
  status: 'active',
  level: '',
  commission_rate: 0.05,
  subject_name: 'Li Si',
  id_no: '',
  company_name: '',
  tax_no: '',
  bank_name: 'ICBC',
  bank_account: '4321',
  bank_branch: '',
  contact_name: '',
  contact_phone: '13800000000',
  contact_email: '',
  reject_reason: '',
  approved_at: 1_772_100_000,
  created_at: 1_772_000_000,
  updated_at: 1_772_000_000,
}

const BASE_OVERVIEW: AgentOverview = {
  profile: BASE_PROFILE,
  effective_rate: 0.05,
  stats: {
    available: 500,
    total: 900,
    withdrawn: 400,
    customer_count: 3,
  },
  aff_code: '2dfZb4',
  promo_link: 'https://example.test/r/2dfZb4',
  register_link: 'https://example.test/register?aff=2dfZb4',
  withdrawal: { min_amount: 100, fee_rate: 0, can_apply: true },
  programme: { default_rate: 0.05, freeze_days: 7, auto_approve: false },
}

/** Same overview with one withdrawal rule overridden. */
function withFeeRate(feeRate: number): AgentOverview {
  return {
    ...BASE_OVERVIEW,
    withdrawal: { ...BASE_OVERVIEW.withdrawal, fee_rate: feeRate },
  }
}

/** Opens the dialog the way the earnings card does, without mounting the card. */
function DialogOpener() {
  const { openWithdrawal } = useAgent()
  return (
    <button type='button' onClick={() => openWithdrawal('bank')}>
      open
    </button>
  )
}

async function openDialog(overview: AgentOverview = BASE_OVERVIEW) {
  getAgentOverview.mockResolvedValue({ success: true, data: overview })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <AgentProvider>
        <DialogOpener />
        <WithdrawalDialog />
      </AgentProvider>
    </QueryClientProvider>
  )

  await waitFor(() => {
    expect(getAgentOverview).toHaveBeenCalled()
  })
  await user.click(screen.getByRole('button', { name: 'open' }))

  return screen.findByLabelText('Withdrawal Amount')
}

/**
 * Reads one line of the fee breakdown. Scoped by its label because the three
 * figures coincide whenever the fee is zero.
 */
function breakdownValue(label: string): string {
  const row = screen.getByText(label).parentElement
  return row?.textContent?.replace(label, '').trim() ?? ''
}

beforeEach(() => {
  createAgentWithdrawal.mockResolvedValue({ success: true })
})

describe('withdrawal fee and net preview', () => {
  test('charges no fee and pays out the full amount when the rate is zero', async () => {
    const amountInput = await openDialog()

    await user.type(amountInput, '250')

    // The platform absorbs the fee by default, so requested equals received.
    expect(breakdownValue('Requested')).toBe('¥250.00')
    expect(breakdownValue('Processing Fee')).toBe('¥0.00')
    expect(breakdownValue('You Receive')).toBe('¥250.00')
  })

  test('splits the amount into fee and net when a fee rate applies', async () => {
    const amountInput = await openDialog(withFeeRate(0.02))

    await user.type(amountInput, '250')

    // 250 × 2% = 5.00 fee, leaving 245.00.
    expect(breakdownValue('Processing Fee')).toBe('¥5.00')
    expect(breakdownValue('You Receive')).toBe('¥245.00')
  })

  test('rounds the fee on cents rather than trailing a float artifact', async () => {
    const amountInput = await openDialog(withFeeRate(0.015))

    await user.type(amountInput, '100.10')

    // 100.10 × 1.5% = 1.5015 → ¥1.50, net ¥98.60. Naive float arithmetic
    // yields 1.5014999999999998 here.
    expect(breakdownValue('Processing Fee')).toBe('¥1.50')
    expect(breakdownValue('You Receive')).toBe('¥98.60')
  })

  test('recomputes the preview as the amount changes', async () => {
    const amountInput = await openDialog(withFeeRate(0.1))

    await user.type(amountInput, '200')
    expect(breakdownValue('Processing Fee')).toBe('¥20.00')

    await user.clear(amountInput)
    await user.type(amountInput, '300')

    expect(breakdownValue('Processing Fee')).toBe('¥30.00')
    expect(breakdownValue('You Receive')).toBe('¥270.00')
  })

  test('holds the preview at zero before an amount is entered', async () => {
    await openDialog(withFeeRate(0.02))

    expect(breakdownValue('Requested')).toBe('¥0.00')
    expect(breakdownValue('Processing Fee')).toBe('¥0.00')
    expect(breakdownValue('You Receive')).toBe('¥0.00')
  })
})

describe('withdrawal amount validation', () => {
  test('blocks submission and flags the field below the minimum', async () => {
    const amountInput = await openDialog()

    await user.type(amountInput, '50')

    expect(amountInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter at least ¥100.00')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Submit Request' })
    ).toBeDisabled()
  })

  test('blocks submission above the available balance', async () => {
    const amountInput = await openDialog()

    await user.type(amountInput, '900')

    expect(amountInput).toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.getByText('That is more than you can withdraw right now')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Submit Request' })
    ).toBeDisabled()
  })

  test('submits the amount and the selected method once the input is valid', async () => {
    const amountInput = await openDialog()

    await user.type(amountInput, '250')
    await user.click(screen.getByRole('radio', { name: 'Bank Transfer' }))
    await user.click(
      screen.getByRole('button', { name: 'Submit Request' })
    )

    await waitFor(() => {
      expect(createAgentWithdrawal).toHaveBeenCalledWith({
        amount: 250,
        method: 'bank',
      })
    })
  })

  test('warns that bank details are missing before a bank payout', async () => {
    await openDialog({
      ...BASE_OVERVIEW,
      profile: { ...BASE_PROFILE, bank_account: '' },
    })

    expect(
      screen.getByText(
        'Add your bank details before requesting a bank transfer'
      )
    ).toBeInTheDocument()
  })
})
