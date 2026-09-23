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
import { describe, expect, test, vi } from 'vitest'

import {
  PlaygroundTopbar,
  type PlaygroundTopbarProps,
} from '../playground-topbar'

function renderTopbar(overrides: Partial<PlaygroundTopbarProps> = {}) {
  const props: PlaygroundTopbarProps = {
    modelName: 'glm-5.2',
    isStreamEnabled: true,
    onStreamEnabledChange: vi.fn(),
    isDebugEnabled: false,
    onDebugEnabledChange: vi.fn(),
    ...overrides,
  }

  return { props, ...render(<PlaygroundTopbar {...props} />) }
}

describe('naming the channel the next request will use', () => {
  test('shows the line code of a pinned channel and nothing else', () => {
    renderTopbar({ channel: { id: 12, code: 'hs4' } })

    expect(screen.getByText('hs4')).toBeInTheDocument()
    // The supplier category is deliberately absent: it never varies between the
    // lines of one model, so it filled the bar without telling the reader which
    // line they are on.
    expect(
      screen.queryByText(/Public cloud|Aggregator/)
    ).not.toBeInTheDocument()
  })

  test('falls back to the id when the channel has no line code', () => {
    renderTopbar({ channel: { id: 12 } })

    expect(screen.getByText('#12')).toBeInTheDocument()
  })

  test('says automatic routing when nothing is pinned', () => {
    renderTopbar()

    expect(screen.getByText('Automatic routing')).toBeInTheDocument()
  })
})

/**
 * Below `lg` the model library sidebar is hidden entirely, which makes this bar
 * the only place the active channel appears. It must not hide with it.
 */
describe('visibility across breakpoints', () => {
  test('carries no breakpoint-gated hiding of its own', () => {
    const { container } = renderTopbar()
    const bar = container.firstElementChild

    expect(bar?.className).not.toMatch(/(^|\s|:)hidden(\s|$)/)
  })
})

/**
 * The streaming switch. `stream` defaults to on and had no control at all, so
 * the non-streaming path was unreachable from the UI.
 */
describe('the streaming switch', () => {
  test('reports the current mode as a pressed state', () => {
    renderTopbar({ isStreamEnabled: true })

    expect(screen.getByRole('button', { name: 'Streaming' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('names the mode it is in when streaming is off', () => {
    renderTopbar({ isStreamEnabled: false })

    const button = screen.getByRole('button', { name: 'Non-streaming' })

    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  test('asks to turn streaming off when it is on', async () => {
    const { props } = renderTopbar({ isStreamEnabled: true })

    await userEvent.click(screen.getByRole('button', { name: 'Streaming' }))

    expect(props.onStreamEnabledChange).toHaveBeenCalledWith(false)
  })

  test('asks to turn streaming back on when it is off', async () => {
    const { props } = renderTopbar({ isStreamEnabled: false })

    await userEvent.click(screen.getByRole('button', { name: 'Non-streaming' }))

    expect(props.onStreamEnabledChange).toHaveBeenCalledWith(true)
  })
})

describe('the debug switch', () => {
  test('reports its state so the pressed styling matches it', () => {
    renderTopbar({ isDebugEnabled: true })

    expect(screen.getByRole('button', { name: 'Debug' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('reports outward instead of holding the state itself', async () => {
    const { props } = renderTopbar({ isDebugEnabled: false })
    const button = screen.getByRole('button', { name: 'Debug' })

    await userEvent.click(button)

    expect(props.onDebugEnabledChange).toHaveBeenCalledWith(true)
    // Still unpressed: the page owns this, so nothing changed without it.
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })
})
