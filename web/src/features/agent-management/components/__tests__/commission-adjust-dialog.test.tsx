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

const adjustCommission = vi.fn()

vi.mock('../../api', () => ({
  adjustCommission: (...args: unknown[]) => adjustCommission(...args),
}))

// Typing a multi-word reason one delayed keystroke at a time overruns the test
// timeout when the suite runs in parallel. The gating behaviour under test does
// not depend on inter-keystroke timing.
const user = userEvent.setup({ delay: null })

const { CommissionAdjustDialog } = await import('../commission-adjust-dialog')
const { AgentsProvider, useAgents } = await import('../agents-provider')

function OpenAdjustDialog() {
  const { setOpen } = useAgents()
  return (
    <button type='button' onClick={() => setOpen('commission-adjust')}>
      open
    </button>
  )
}

async function openDialog() {
  render(
    <AgentsProvider>
      <OpenAdjustDialog />
      <CommissionAdjustDialog />
    </AgentsProvider>
  )
  await user.click(screen.getByRole('button', { name: 'open' }))
}

beforeEach(() => {
  adjustCommission.mockResolvedValue({ success: true })
})

describe('commission adjustment gating', () => {
  test('keeps Record Adjustment disabled until a reason is written', async () => {
    await openDialog()

    const submit = await screen.findByRole('button', {
      name: 'Record Adjustment',
    })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('Agent user ID'), '88')
    await user.type(screen.getByLabelText('Amount (CNY)'), '-120.5')
    // Amount and agent alone are not enough: an unexplained ledger row is
    // exactly what the reason requirement exists to prevent.
    expect(submit).toBeDisabled()

    await user.type(
      screen.getByLabelText('Reason'),
      'clawback for refunded order 70001'
    )
    expect(submit).toBeEnabled()
  })

  test('submits a negative adjustment as a new row with its reason', async () => {
    await openDialog()

    await user.type(await screen.findByLabelText('Agent user ID'), '88')
    await user.type(screen.getByLabelText('Amount (CNY)'), '-120.5')
    await user.type(
      screen.getByLabelText('Reason'),
      '  clawback for refunded order 70001  '
    )
    await user.click(
      screen.getByRole('button', { name: 'Record Adjustment' })
    )

    await waitFor(() => {
      expect(adjustCommission).toHaveBeenCalledWith({
        agent_user_id: 88,
        amount: -120.5,
        reason: 'clawback for refunded order 70001',
      })
    })
  })

  test('previews the signed amount as it will be recorded', async () => {
    await openDialog()

    await user.type(await screen.findByLabelText('Amount (CNY)'), '-120.5')

    expect(screen.getByText('Will be recorded as -¥120.50')).toBeInTheDocument()
  })

  test('rejects a zero adjustment, which would add a meaningless row', async () => {
    await openDialog()

    await user.type(await screen.findByLabelText('Agent user ID'), '88')
    await user.type(screen.getByLabelText('Amount (CNY)'), '0')
    await user.type(
      screen.getByLabelText('Reason'),
      'this should not be accepted'
    )
    await user.click(
      screen.getByRole('button', { name: 'Record Adjustment' })
    )

    expect(await screen.findByText('Amount cannot be zero')).toBeInTheDocument()
    expect(adjustCommission).not.toHaveBeenCalled()
  })

  test('states that the ledger is appended to, not edited', async () => {
    await openDialog()

    expect(
      await screen.findByText(
        'This adds a new ledger row. Nothing already recorded is changed or removed.'
      )
    ).toBeInTheDocument()
  })
})
