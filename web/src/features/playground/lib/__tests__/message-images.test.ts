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
import { describe, expect, test } from 'vitest'

import type { Message } from '../../types'
import { appendUserMessagePair } from '../message/conversation-message-utils'
import { getMessageContentState } from '../message/message-content-utils'
import { formatMessageForAPI } from '../message/message-utils'

const PNG_DATA_URL = 'data:image/png;base64,AAAA'

function userMessage(content: string, images?: string[]): Message {
  return {
    key: 'msg-1',
    from: 'user',
    versions: [{ id: 'v1', content }],
    images,
  }
}

describe('formatMessageForAPI', () => {
  test('sends a plain string when the message has no image', () => {
    expect(formatMessageForAPI(userMessage('hello'))).toEqual({
      role: 'user',
      content: 'hello',
    })
  })

  test('sends text and image parts when the message has an image', () => {
    expect(
      formatMessageForAPI(userMessage('what is this', [PNG_DATA_URL]))
    ).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this' },
        { type: 'image_url', image_url: { url: PNG_DATA_URL } },
      ],
    })
  })

  test('keeps an empty text part for an image-only message', () => {
    expect(formatMessageForAPI(userMessage('', [PNG_DATA_URL]))).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '' },
        { type: 'image_url', image_url: { url: PNG_DATA_URL } },
      ],
    })
  })
})

describe('appendUserMessagePair', () => {
  test('stores the submitted images on the new user message', () => {
    const messages = appendUserMessagePair([], 'look', [PNG_DATA_URL])

    expect(messages[0].images).toEqual([PNG_DATA_URL])
  })

  test('omits the images field when nothing was attached', () => {
    const messages = appendUserMessagePair([], 'look')

    expect(messages[0].images).toBeUndefined()
  })
})

describe('getMessageContentState', () => {
  test('renders images for an image-only user message', () => {
    const state = getMessageContentState(userMessage('', [PNG_DATA_URL]), '')

    expect(state.showMessageImages).toBe(true)
    expect(state.showMessageContent).toBe(false)
    expect(state.images).toEqual([PNG_DATA_URL])
  })

  test('does not render images for assistant messages', () => {
    const state = getMessageContentState(
      { ...userMessage('answer', [PNG_DATA_URL]), from: 'assistant' },
      'answer'
    )

    expect(state.showMessageImages).toBe(false)
  })
})
