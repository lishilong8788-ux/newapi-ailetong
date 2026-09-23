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

import type { Message } from '../../../types'

const getModelChannelPricing = vi.fn()
vi.mock('@/features/pricing/api', () => ({
  getModelChannelPricing: () => getModelChannelPricing(),
}))

const { MessageActions } = await import('../message-actions')

function reply(overrides: Partial<Message> = {}): Message {
  return {
    key: 'assistant-1',
    from: 'assistant',
    versions: [{ id: 'v1', content: 'hello' }],
    status: 'complete',
    durationMs: 2_180,
    channel: { id: 12, code: 'hs4', pinned: true },
    ttftMs: 402,
    ...overrides,
  }
}

function renderActions(props: { isDebugEnabled?: boolean; message?: Message }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MessageActions
        isDebugEnabled={props.isDebugEnabled}
        message={props.message ?? reply()}
        modelName='glm-5.2'
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getModelChannelPricing.mockResolvedValue({ success: true, data: [] })
})

/**
 * The debug entry is gated on the topbar switch: these rows answer "why was this
 * reply slow", which most sessions are not asking, so they are not offered by
 * default.
 */
describe('offering the debug entry on a reply', () => {
  test('offers nothing while the debug switch is off', () => {
    renderActions({ isDebugEnabled: false })

    expect(
      screen.queryByRole('button', { name: 'Debug' })
    ).not.toBeInTheDocument()
  })

  test('offers a collapsed entry once the switch is on', () => {
    renderActions({ isDebugEnabled: true })

    expect(screen.getByRole('button', { name: 'Debug' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByText('Channel')).not.toBeInTheDocument()
  })

  test('reveals the panel when the entry is opened', async () => {
    renderActions({ isDebugEnabled: true })

    await userEvent.click(screen.getByRole('button', { name: 'Debug' }))

    expect(screen.getByRole('button', { name: 'Debug' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByText('Channel')).toBeInTheDocument()
    expect(screen.getByText('You pinned this')).toBeInTheDocument()
  })

  test('hides the panel again when the entry is closed', async () => {
    renderActions({ isDebugEnabled: true })
    const entry = screen.getByRole('button', { name: 'Debug' })

    await userEvent.click(entry)
    await userEvent.click(entry)

    expect(entry).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Channel')).not.toBeInTheDocument()
  })

  // A user's own message has no channel and no first-token time to report.
  test('offers no entry on a user message', () => {
    renderActions({
      isDebugEnabled: true,
      message: reply({ from: 'user', channel: undefined, ttftMs: undefined }),
    })

    expect(
      screen.queryByRole('button', { name: 'Debug' })
    ).not.toBeInTheDocument()
  })
})
