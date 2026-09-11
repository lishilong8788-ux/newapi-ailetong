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

import type { AgentListItem } from '../../types'

const setAgentCommissionRate = vi.fn()

vi.mock('../../api', () => ({
  setAgentCommissionRate: (...args: unknown[]) =>
    setAgentCommissionRate(...args),
}))

const { AgentRateDialog } = await import('../agent-rate-dialog')
const { AgentsProvider, useAgents } = await import('../agents-provider')

const BASE_AGENT: AgentListItem = {
  id: 5,
  user_id: 88,
  agent_type: 'company',
  status: 'active',
  level: '',
  commission_rate: 0.05,
  subject_name: '',
  id_no: '',
  company_name: 'Northbound Tech Ltd.',
  tax_no: '',
  bank_name: '',
  bank_account: '',
  bank_branch: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  audit_by: 0,
  audit_time: 0,
  reject_reason: '',
  remark: '',
  created_at: 1_772_000_000,
  updated_at: 1_772_000_000,
  username: 'north-reseller',
  display_name: 'North Reseller',
  customer_count: 12,
  agent_commission_total: 0,
  agent_commission_available: 0,
  agent_withdrawn_total: 0,
}

const SECOND_AGENT: AgentListItem = {
  ...BASE_AGENT,
  id: 6,
  user_id: 89,
  username: 'south-reseller',
  customer_count: 30,
}

function OpenRateDialog(props: { batch?: boolean }) {
  const { setOpen, setCurrentAgent, setBatchAgents } = useAgents()
  return (
    <button
      type='button'
      onClick={() => {
        if (props.batch) {
          setBatchAgents([BASE_AGENT, SECOND_AGENT])
          setOpen('agent-batch-rate')
          return
        }
        setCurrentAgent(BASE_AGENT)
        setOpen('agent-rate')
      }}
    >
      open
    </button>
  )
}

async function openDialog(batch?: boolean) {
  render(
    <AgentsProvider>
      <OpenRateDialog batch={batch} />
      <AgentRateDialog />
    </AgentsProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'open' }))
}

beforeEach(() => {
  setAgentCommissionRate.mockResolvedValue({ success: true })
})

describe('batch rate blast radius', () => {
  test('states how many agents and customers a bulk change reprices', async () => {
    await openDialog(true)

    const warning = await screen.findByRole('alert')
    // The rate drives every future payout, so the scope has to be on screen
    // before the operator can confirm it.
    expect(warning).toHaveTextContent('2 agent(s) will be repriced')
    expect(warning).toHaveTextContent('They currently hold 42 customer(s).')
  })

  test('applies the new rate to every selected agent', async () => {
    await openDialog(true)

    await userEvent.type(
      await screen.findByLabelText('Commission Rate (%)'),
      '7.5'
    )
    await userEvent.type(
      screen.getByLabelText('Reason'),
      'Q4 partner programme repricing'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(setAgentCommissionRate).toHaveBeenCalledTimes(2)
    })
    // Percent in the form, fraction on the wire — converted once, in one place.
    expect(setAgentCommissionRate).toHaveBeenCalledWith(5, { rate: 0.075 })
    expect(setAgentCommissionRate).toHaveBeenCalledWith(6, { rate: 0.075 })
  })

  test('shows no blast-radius warning for a single agent', async () => {
    await openDialog()

    expect(await screen.findByText('Current rate: 5%')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('rate change reason requirement', () => {
  test('blocks submission until a reason is given', async () => {
    await openDialog()

    await userEvent.type(
      await screen.findByLabelText('Commission Rate (%)'),
      '9'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    // The rate is valid but unexplained, and the change is written to the audit
    // log, so it must not go through.
    expect(
      await screen.findByText('Reason must be at least 5 characters long')
    ).toBeInTheDocument()
    expect(setAgentCommissionRate).not.toHaveBeenCalled()
  })

  test('constrains the rate input so a 150% typo cannot be entered', async () => {
    await openDialog()

    // First line of defence against the classic 5-vs-0.05 slip. The schema bound
    // behind it is covered directly in the lib tests, because the input itself
    // already refuses the out-of-range keystroke.
    const rateInput = await screen.findByLabelText('Commission Rate (%)')
    expect(rateInput).toHaveAttribute('max', '100')
    expect(rateInput).toHaveAttribute('min', '0')
  })
})

describe('following the global default', () => {
  test('sends null rather than zero when the override is cleared', async () => {
    await openDialog()

    await userEvent.click(
      await screen.findByRole('checkbox', {
        name: 'Follow the global default rate',
      })
    )
    await userEvent.type(
      screen.getByLabelText('Reason'),
      'return to the platform default'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    // null means "follow the default"; 0 means "pay nothing". Sending 0 here
    // would silently cut the agent's earnings to zero.
    await waitFor(() => {
      expect(setAgentCommissionRate).toHaveBeenCalledWith(5, { rate: null })
    })
  })

  test('disables the rate input while the default is being followed', async () => {
    await openDialog()

    const followDefault = await screen.findByRole('checkbox', {
      name: 'Follow the global default rate',
    })
    await userEvent.click(followDefault)

    expect(followDefault).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Commission Rate (%)')).toBeDisabled()
  })
})
