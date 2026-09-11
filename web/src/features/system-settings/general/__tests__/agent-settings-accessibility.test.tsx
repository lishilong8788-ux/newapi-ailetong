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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

// The section mounts FormNavigationGuard, whose useBlocker needs a router.
vi.mock('@tanstack/react-router', () => ({
  useBlocker: () => ({ status: 'idle', proceed: undefined, reset: undefined }),
}))

const updateSystemOption = vi.fn()
vi.mock('../../api', () => ({
  updateSystemOption: (...args: unknown[]) => updateSystemOption(...args),
}))

const { AgentSettingsSection } = await import('../agent-settings-section')
const { SettingsPageProvider } =
  await import('../../components/settings-page-context')

const DEFAULTS = {
  AgentEnabled: true,
  AgentDefaultRate: 0.05,
  AgentMaxRate: 0.3,
  AgentFreezeDays: 7,
  AgentMinWithdrawal: 100,
  AgentWithdrawalFeeRate: 0,
  AgentAutoApprove: false,
  AgentBalanceNeedAudit: false,
  AgentSubscriptionCommission: false,
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const actionsContainer = document.createElement('div')
  document.body.append(actionsContainer)

  const result = render(
    <QueryClientProvider client={queryClient}>
      <SettingsPageProvider actionsContainer={actionsContainer}>
        <AgentSettingsSection defaultValues={DEFAULTS} />
      </SettingsPageProvider>
    </QueryClientProvider>
  )

  return { ...result, queryClient }
}

describe('agent distribution settings accessibility', () => {
  test('labels every numeric field with its unit so the rate unit is unambiguous', () => {
    renderSection()

    expect(
      screen.getByRole('spinbutton', { name: 'Default commission rate (%)' })
    ).toHaveValue(5)
    expect(
      screen.getByRole('spinbutton', { name: 'Maximum commission rate (%)' })
    ).toHaveValue(30)
    expect(
      screen.getByRole('spinbutton', { name: 'Withdrawal fee rate (%)' })
    ).toHaveValue(0)
    expect(
      screen.getByRole('spinbutton', {
        name: 'Commission freeze window (days)',
      })
    ).toHaveValue(7)
    expect(
      screen.getByRole('spinbutton', { name: 'Minimum withdrawal (CNY)' })
    ).toHaveValue(100)
  })

  test('gives every switch an accessible name', () => {
    renderSection()

    for (const name of [
      'Enable agent distribution',
      'Pay commission on subscription orders',
      'Review payouts to account balance',
      'Approve agent applications automatically',
    ]) {
      expect(screen.getByRole('switch', { name })).toBeInTheDocument()
    }
  })

  test('marks the default rate invalid and describes why when it exceeds the ceiling', async () => {
    renderSection()

    const defaultRate = screen.getByRole('spinbutton', {
      name: 'Default commission rate (%)',
    })
    fireEvent.change(defaultRate, { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(defaultRate).toHaveAttribute('aria-invalid', 'true')
    })

    const message = screen.getByText(
      'Default commission rate cannot exceed the maximum commission rate'
    )
    expect(defaultRate.getAttribute('aria-describedby')).toContain(message.id)
    expect(updateSystemOption).not.toHaveBeenCalled()
  })
})
