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
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import type { Message } from '../../../types'
import { MessageMetadata } from '../message-metadata'

function reply(overrides: Partial<Message> = {}): Message {
  return {
    key: 'assistant-1',
    from: 'assistant',
    versions: [{ id: 'v1', content: 'hello' }],
    status: 'complete',
    createdAt: Date.UTC(2026, 8, 22, 7, 6, 39),
    durationMs: 2_180,
    ...overrides,
  }
}

/**
 * The always-visible line under a reply. Channel and first-token time are both
 * routinely unknown, so each has to disappear cleanly rather than leave a
 * placeholder standing in for a measurement that was never taken.
 */
describe('the metadata line under a reply', () => {
  test('names the channel by its line code', () => {
    render(
      <MessageMetadata
        alignment='left'
        message={reply({ channel: { id: 12, code: 'hs4', pinned: true } })}
      />
    )

    expect(screen.getByText('via hs4')).toBeInTheDocument()
  })

  test('falls back to the channel id when there is no line code', () => {
    render(
      <MessageMetadata
        alignment='left'
        message={reply({ channel: { id: 12, pinned: false } })}
      />
    )

    expect(screen.getByText('via #12')).toBeInTheDocument()
  })

  test('shows the first-token time when one was measured', () => {
    render(
      <MessageMetadata alignment='left' message={reply({ ttftMs: 402 })} />
    )

    expect(screen.getByText('First token 402ms')).toBeInTheDocument()
  })

  test('omits both segments when neither is known', () => {
    render(<MessageMetadata alignment='left' message={reply()} />)

    expect(screen.queryByText(/via/)).not.toBeInTheDocument()
    expect(screen.queryByText(/First token/)).not.toBeInTheDocument()
  })

  // The duration was the only segment before this change and has to survive it.
  test('keeps showing the response duration', () => {
    render(<MessageMetadata alignment='left' message={reply()} />)

    expect(screen.getByText('2.18s')).toBeInTheDocument()
  })

  test('renders nothing at all for a reply with no timing of any kind', () => {
    const { container } = render(
      <MessageMetadata
        alignment='left'
        message={reply({ createdAt: undefined, durationMs: undefined })}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
