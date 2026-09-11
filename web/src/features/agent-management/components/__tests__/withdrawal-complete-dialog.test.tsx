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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { AgentWithdrawal } from '../../types'

const completeWithdrawal = vi.fn()

vi.mock('../../api', () => ({
  completeWithdrawal: (...args: unknown[]) => completeWithdrawal(...args),
}))

const { WithdrawalCompleteDialog } =
  await import('../withdrawal-complete-dialog')
const { AgentsProvider, useAgents } = await import('../agents-provider')

const APPROVED_WITHDRAWAL: AgentWithdrawal = {
  id: 41,
  agent_user_id: 88,
  username: 'north-reseller',
  display_name: 'North Reseller',
  amount: 1200,
  fee: 24,
  actual_amount: 1176,
  method: 'bank',
  status: 'approved',
  pay_voucher: '',
  reject_reason: '',
  create_time: 1_772_000_000,
  audit_time: 1_772_100_000,
  pay_time: 0,
  audit_by: 3,
}

function OpenCompleteDialog() {
  const { setOpen, setCurrentWithdrawal } = useAgents()
  return (
    <button
      type='button'
      onClick={() => {
        setCurrentWithdrawal(APPROVED_WITHDRAWAL)
        setOpen('withdrawal-complete')
      }}
    >
      open
    </button>
  )
}

async function openDialog() {
  render(
    <AgentsProvider>
      <OpenCompleteDialog />
      <WithdrawalCompleteDialog />
    </AgentsProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'open' }))
}

beforeEach(() => {
  completeWithdrawal.mockResolvedValue({ success: true })
})

describe('mark-paid voucher gating', () => {
  test('keeps Mark Paid disabled until a voucher number is entered', async () => {
    await openDialog()

    const submit = await screen.findByRole('button', { name: 'Mark Paid' })
    expect(submit).toBeDisabled()

    // Marking paid is terminal, so the bank reference is the only trace left
    // afterwards — a one-character stub does not qualify.
    await userEvent.type(screen.getByLabelText('Payment Voucher'), 'X')
    expect(submit).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Payment Voucher'), 'FER2026')
    expect(submit).toBeEnabled()
  })

  test('posts the trimmed voucher for the selected withdrawal', async () => {
    await openDialog()

    await userEvent.type(
      await screen.findByLabelText('Payment Voucher'),
      '  ICBC20260908771  '
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mark Paid' }))

    await waitFor(() => {
      expect(completeWithdrawal).toHaveBeenCalledWith(41, {
        voucher: 'ICBC20260908771',
      })
    })
  })

  test('states the irreversibility and the net amount being paid', async () => {
    await openDialog()

    expect(
      await screen.findByText(
        'This settles the claimed commission and cannot be undone. Only confirm once the transfer has actually left the bank.'
      )
    ).toBeInTheDocument()
    // Net, not requested: the fee is already deducted, and paying the gross
    // would overpay by the fee every time.
    expect(screen.getByText(/¥1,176\.00/)).toBeInTheDocument()
  })
})
