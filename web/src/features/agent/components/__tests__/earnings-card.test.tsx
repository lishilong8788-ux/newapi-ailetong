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

import type { AgentOverview, AgentStatus } from '../../types'

const getAgentOverview = vi.fn()
vi.mock('../../api', () => ({
  getAgentOverview: () => getAgentOverview(),
}))

const { EarningsCard } = await import('../earnings-card')
const { WithdrawalDialog } = await import('../dialogs/withdrawal-dialog')
const { AgentProvider } = await import('../agent-provider')

/** Only an approved profile reaches this card, so both statuses are post-review. */
function buildOverview(status: Extract<AgentStatus, 'active' | 'suspended'>) {
  const overview: AgentOverview = {
    profile: {
      id: 1,
      user_id: 42,
      agent_type: 'personal',
      status,
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
    },
    effective_rate: 0.05,
    stats: {
      available: 320.5,
      total: 1280.75,
      withdrawn: 960.25,
      customer_count: 7,
    },
    aff_code: '2dfZb4',
    promo_link: 'https://example.test/r/2dfZb4',
    register_link: 'https://example.test/register?aff=2dfZb4',
    withdrawal: { min_amount: 100, fee_rate: 0, can_apply: true },
    programme: { default_rate: 0.05, freeze_days: 7, auto_approve: false },
  }
  return overview
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentProvider>
        <EarningsCard />
        <WithdrawalDialog />
      </AgentProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getAgentOverview.mockResolvedValue({
    success: true,
    data: buildOverview('active'),
  })
})

describe('agent earnings card figures', () => {
  test('reads available, total earned and invited count as RMB and a count', async () => {
    renderCard()

    // Commission is RMB, not quota: it must not be re-scaled by the quota
    // display rate.
    expect(await screen.findByText('¥320.50')).toBeInTheDocument()
    expect(screen.getByText('¥1,280.75')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})

describe('agent withdraw gate', () => {
  test('enables both withdraw actions once the profile is active', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Withdraw' })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: 'To Balance' })).toBeEnabled()
  })

  test('disables both withdraw actions and blames the suspension when the account is suspended', async () => {
    getAgentOverview.mockResolvedValue({
      success: true,
      data: buildOverview('suspended'),
    })

    renderCard()

    const withdraw = await screen.findByRole('button', { name: 'Withdraw' })
    const toBalance = screen.getByRole('button', { name: 'To Balance' })

    expect(withdraw).toBeDisabled()
    expect(toBalance).toBeDisabled()

    // The reason is attached to both buttons, not just printed nearby, so a
    // screen reader announces it with the disabled control.
    const hintId = withdraw.getAttribute('aria-describedby')
    expect(hintId).toBeTruthy()
    expect(toBalance).toHaveAttribute('aria-describedby', hintId)
    expect(document.querySelector(`#${hintId}`)).toHaveTextContent(/suspended/i)
  })

  test('keeps the withdrawal records action available while withdrawing is gated', async () => {
    getAgentOverview.mockResolvedValue({
      success: true,
      data: buildOverview('suspended'),
    })

    renderCard()

    // Reviewing past requests is not a money movement, so it stays reachable.
    expect(await screen.findByRole('button', { name: 'Records' })).toBeEnabled()
  })

  test('opens the withdrawal dialog preset to balance from the shortcut', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'To Balance' })).toBeEnabled()
    })
    await userEvent.click(screen.getByRole('button', { name: 'To Balance' }))

    const balance = await screen.findByRole('radio', {
      name: 'Transfer to Balance',
    })
    expect(balance).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByRole('radio', { name: 'Bank Transfer' })
    ).toHaveAttribute('aria-checked', 'false')
  })
})
