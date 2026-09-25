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
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'

import { CopilotToolStep } from '../components/copilot-tool-step'
import type { CopilotToolBlock } from '../types'

function block(overrides: Partial<CopilotToolBlock> = {}): CopilotToolBlock {
  return {
    kind: 'tool',
    id: 'tool-0',
    toolCallId: 'call_1',
    toolName: 'query_cost_overview',
    args: { days: 30 },
    status: 'success',
    durationMs: 412,
    ...overrides,
  }
}

describe('tool step disclosure', () => {
  test('starts collapsed with the arguments hidden', () => {
    render(<CopilotToolStep block={block()} />)

    const trigger = screen.getByRole('button')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/"days": 30/)).not.toBeInTheDocument()
  })

  test('expanding reveals the arguments JSON and flips aria-expanded', async () => {
    const user = userEvent.setup()
    render(<CopilotToolStep block={block()} />)

    await user.click(screen.getByRole('button'))

    const trigger = screen.getByRole('button')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const panelId = trigger.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.querySelector(`#${panelId}`)).toHaveTextContent(
      '"days": 30'
    )
  })

  test('shows the duration so a step reads as a measurement', () => {
    render(<CopilotToolStep block={block({ durationMs: 1500 })} />)

    expect(screen.getByText('1.50s')).toBeInTheDocument()
  })

  test('a failed step states the error inline and carries a failed status icon', () => {
    render(
      <CopilotToolStep
        block={block({ status: 'error', errorText: 'channel 7 has no price' })}
      />
    )

    expect(screen.getByText('channel 7 has no price')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Failed' })).toBeInTheDocument()
  })

  test('a running step announces itself as loading rather than done', () => {
    render(
      <CopilotToolStep
        block={block({ status: 'running', durationMs: undefined })}
      />
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Done' })).not.toBeInTheDocument()
  })
})
