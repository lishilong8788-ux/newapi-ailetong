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

import { MESSAGE_STATUS } from '../../../constants'
import type { Message } from '../../../types'
import { MessageVideos } from '../message-videos'
import { PlaygroundMessageContent } from '../playground-message-content'

function pendingMessage(overrides: Partial<Message> = {}): Message {
  return {
    key: 'assistant-1',
    from: 'assistant',
    versions: [{ id: 'v1', content: '' }],
    status: MESSAGE_STATUS.LOADING,
    ...overrides,
  }
}

function renderContent(message: Message) {
  return render(
    <PlaygroundMessageContent
      actions={null}
      alignment='left'
      message={message}
      versionContent=''
    />
  )
}

/**
 * The waiting state for an async task. A video runs for minutes, so what this
 * says while nothing is on screen is most of the experience.
 */
describe('the pending state of a task-backed message', () => {
  test('names the wait as video generation, not a generic response', () => {
    renderContent(pendingMessage({ isTaskPending: true }))

    expect(screen.getByText(/Generating video/)).toBeInTheDocument()
    expect(screen.queryByText('Responding...')).not.toBeInTheDocument()
  })

  // The flag is set at submit time precisely so this holds before the first poll
  // returns; inferring it from progress would show the chat wording for a couple
  // of seconds and then visibly change its mind.
  test('says so before any progress is known', () => {
    renderContent(pendingMessage({ isTaskPending: true }))

    expect(screen.getByText(/Generating video/)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  test('keeps the chat wording for a chat message', () => {
    renderContent(pendingMessage())

    expect(screen.getByText('Responding...')).toBeInTheDocument()
  })

  test('renders a bar once the platform reports progress', () => {
    renderContent(pendingMessage({ isTaskPending: true, taskProgress: 40 }))

    const bar = screen.getByRole('progressbar')

    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  // A bar pinned at 0 for two minutes looks broken rather than slow, so a
  // platform that reports nothing gets no bar at all.
  test('shows no bar when progress is absent', () => {
    renderContent(pendingMessage({ isTaskPending: true }))

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  test('distinguishes zero progress from unknown progress', () => {
    renderContent(pendingMessage({ isTaskPending: true, taskProgress: 0 }))

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0'
    )
  })
})

describe('MessageVideos', () => {
  test('renders a playable element per video', () => {
    const { container } = render(
      <MessageVideos videos={['https://example.com/a.mp4']} />
    )

    const video = container.querySelector('video')

    expect(video).toHaveAttribute('src', 'https://example.com/a.mp4')
    expect(video).toHaveAttribute('controls')
  })

  // These are generated files of unknown size that the user may never play, so
  // fetching the whole thing on render is the difference between a poster frame
  // and several megabytes.
  test('does not preload the whole file', () => {
    const { container } = render(
      <MessageVideos videos={['https://example.com/a.mp4']} />
    )

    expect(container.querySelector('video')).toHaveAttribute(
      'preload',
      'metadata'
    )
  })

  test('renders nothing when there are no videos', () => {
    const { container } = render(<MessageVideos videos={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
