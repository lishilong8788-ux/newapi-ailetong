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
import { afterEach, describe, expect, test } from 'vitest'

import { MESSAGE_STATUS } from '../../constants'
import type { Message, PlaygroundConversations } from '../../types'
import { completeAssistantMessage } from '../message/message-streaming-utils'
import { loadConversations, saveConversations } from '../storage/storage'

const MODEL = 'qwen-image-2.0'

/** Yesterday, so a `Date.now()` stamp would produce an absurd duration. */
const STARTED_AT = Date.now() - 13.5 * 60 * 60 * 1000

function pendingAssistant(): Message {
  return {
    key: 'assistant-1',
    from: 'assistant',
    versions: [{ id: 'assistant-1-v1', content: '' }],
    status: MESSAGE_STATUS.LOADING,
    createdAt: STARTED_AT,
    startedAt: STARTED_AT,
  }
}

function conversation(messages: Message[]): PlaygroundConversations[string] {
  return { messages, updatedAt: STARTED_AT }
}

afterEach(() => {
  localStorage.clear()
})

/**
 * A request that dies without producing anything leaves a pending assistant
 * message behind. On reload it has to come back final, or the next thing that
 * finalises a pending message stamps it with the current time and reports the
 * wall-clock gap as a response time.
 */
describe('a pending message with no content, restored from storage', () => {
  test('comes back final rather than pending', () => {
    saveConversations({ [MODEL]: conversation([pendingAssistant()]) })

    const [restored] = loadConversations(MODEL)[MODEL].messages

    expect(restored.status).toBe(MESSAGE_STATUS.COMPLETE)
  })

  test('reports no duration, since none is knowable', () => {
    saveConversations({ [MODEL]: conversation([pendingAssistant()]) })

    const [restored] = loadConversations(MODEL)[MODEL].messages

    // Undefined, not 0: zero would claim the reply came back instantly.
    expect(restored.durationMs).toBeUndefined()
    expect(restored.completedAt).toBeUndefined()
  })

  test('cannot later be stamped with a wall-clock duration', () => {
    saveConversations({ [MODEL]: conversation([pendingAssistant()]) })

    const [restored] = loadConversations(MODEL)[MODEL].messages
    // What the stop button does, and what a model switch used to do. It only
    // acts on pending messages, so a restored one is now out of its reach.
    const stopped = completeAssistantMessage(restored)

    // The regression this guards: 13.5 hours reported as the response time.
    expect(stopped.durationMs ?? 0).toBeLessThan(1000)
  })

  test('still finalises a pending message that did produce content', () => {
    const withContent: Message = {
      ...pendingAssistant(),
      versions: [{ id: 'assistant-1-v1', content: 'a partial reply' }],
    }
    saveConversations({ [MODEL]: conversation([withContent]) })

    const [restored] = loadConversations(MODEL)[MODEL].messages

    expect(restored.status).toBe(MESSAGE_STATUS.COMPLETE)
    // Measured from the message's own timestamps, never from `Date.now()`.
    expect(restored.durationMs).toBe(0)
  })
})
