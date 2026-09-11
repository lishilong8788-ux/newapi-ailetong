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

import type { AgentWithdrawal, AgentsDialogType } from '../../types'

const approveWithdrawal = vi.fn()
const rejectWithdrawal = vi.fn()
const failWithdrawal = vi.fn()

vi.mock('../../api', () => ({
  approveWithdrawal: (...args: unknown[]) => approveWithdrawal(...args),
  rejectWithdrawal: (...args: unknown[]) => rejectWithdrawal(...args),
  failWithdrawal: (...args: unknown[]) => failWithdrawal(...args),
}))

// Typing a multi-word reason one delayed keystroke at a time overruns the test
// timeout when the suite runs in parallel. The gating behaviour under test does
// not depend on inter-keystroke timing.
const user = userEvent.setup({ delay: null })

const { WithdrawalAuditDialog } = await import('../withdrawal-audit-dialog')
const { AgentsProvider, useAgents } = await import('../agents-provider')

const WITHDRAWAL: AgentWithdrawal = {
  id: 41,
  agent_user_id: 88,
  username: 'north-reseller',
  display_name: 'North Reseller',
  amount: 1200,
  fee: 0,
  actual_amount: 1200,
  method: 'bank',
  status: 'pending',
  pay_voucher: '',
  reject_reason: '',
  create_time: 1_772_000_000,
  audit_time: 0,
  pay_time: 0,
  audit_by: 0,
}

/** Puts the provider into the state a row action would produce. */
function OpenDialog(props: { dialog: AgentsDialogType }) {
  const { setOpen, setCurrentWithdrawal } = useAgents()
  return (
    <button
      type='button'
      onClick={() => {
        setCurrentWithdrawal(WITHDRAWAL)
        setOpen(props.dialog)
      }}
    >
      open
    </button>
  )
}

async function openDialog(dialog: AgentsDialogType) {
  render(
    <AgentsProvider>
      <OpenDialog dialog={dialog} />
      <WithdrawalAuditDialog />
    </AgentsProvider>
  )
  await user.click(screen.getByRole('button', { name: 'open' }))
}

beforeEach(() => {
  approveWithdrawal.mockResolvedValue({ success: true })
  rejectWithdrawal.mockResolvedValue({ success: true })
  failWithdrawal.mockResolvedValue({ success: true })
})

describe('withdrawal reject gating', () => {
  test('keeps Reject disabled until a reason of sufficient length is typed', async () => {
    await openDialog('withdrawal-reject')

    const submit = await screen.findByRole('button', { name: 'Reject' })
    expect(submit).toBeDisabled()

    // Under the minimum: a two-character note explains nothing to the agent
    // whose payout was refused.
    await user.type(screen.getByLabelText('Reject Reason'), 'no')
    expect(submit).toBeDisabled()

    await user.type(
      screen.getByLabelText('Reject Reason'),
      ' matching bank name'
    )
    expect(submit).toBeEnabled()
  })

  test('sends the trimmed reason to the reject endpoint', async () => {
    await openDialog('withdrawal-reject')

    await user.type(
      await screen.findByLabelText('Reject Reason'),
      '  account holder mismatch  '
    )
    await user.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => {
      expect(rejectWithdrawal).toHaveBeenCalledWith(41, {
        reason: 'account holder mismatch',
      })
    })
  })

  test('warns that rejecting releases the claimed commission', async () => {
    await openDialog('withdrawal-reject')

    expect(
      await screen.findByText(
        'The claimed commission returns to the withdrawable balance and the agent can request it again.'
      )
    ).toBeInTheDocument()
  })
})

describe('withdrawal payout-failed gating', () => {
  test('requires a failure reason and posts it to the fail endpoint', async () => {
    await openDialog('withdrawal-fail')

    const submit = await screen.findByRole('button', {
      name: 'Mark Payout Failed',
    })
    expect(submit).toBeDisabled()

    await user.type(
      screen.getByLabelText('Failure Reason'),
      'bank rejected the transfer'
    )
    expect(submit).toBeEnabled()

    await user.click(submit)

    await waitFor(() => {
      expect(failWithdrawal).toHaveBeenCalledWith(41, {
        reason: 'bank rejected the transfer',
      })
    })
    expect(rejectWithdrawal).not.toHaveBeenCalled()
  })
})

describe('withdrawal approve confirmation', () => {
  test('approves without a reason but only after an explicit confirm', async () => {
    await openDialog('withdrawal-approve')

    expect(screen.queryByLabelText('Reject Reason')).not.toBeInTheDocument()
    expect(approveWithdrawal).not.toHaveBeenCalled()

    const submit = await screen.findByRole('button', { name: 'Approve' })
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => {
      expect(approveWithdrawal).toHaveBeenCalledWith(41)
    })
  })
})
