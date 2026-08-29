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
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const CHAT_MODEL = 'DeepSeek-V3'
const OTHER_MODEL = 'DeepSeek-V3.1'

// Only the storage side is stubbed; `applyMessageStateUpdate` is the real
// implementation, since the routing under test is what it gets applied through.
vi.mock('../../lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib')>()

  return {
    ...actual,
    getInitialPlaygroundConfig: () => ({
      model: CHAT_MODEL,
      group: 'default',
      stream: true,
    }),
    loadConversations: () => ({}),
    saveConversations: vi.fn(),
    saveConfig: vi.fn(),
  }
})

import type { Message } from '../../types'
import { usePlaygroundState } from '../use-playground-state'

function assistantMessage(content: string): Message {
  return {
    key: `assistant:${content}`,
    from: 'assistant',
    versions: [{ id: `v:${content}`, content }],
  }
}

/**
 * Guards what lets a model switch leave a request running: a write carrying an
 * explicit target model lands in that model's transcript regardless of which one
 * is selected by the time it arrives.
 *
 * Before this, writes always went to the active model, so a stream outliving a
 * switch appended to the incoming model's history — which is why the switch used
 * to abort the request outright.
 */
describe('updateMessages routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('sends a targeted write to the named model, not the selected one', () => {
    const { result } = renderHook(() => usePlaygroundState())

    act(() => {
      result.current.updateConfig('model', OTHER_MODEL)
    })

    act(() => {
      result.current.updateMessages(
        () => [assistantMessage('reply from the first model')],
        CHAT_MODEL
      )
    })

    // The selected model's canvas stays empty; the reply is waiting under the
    // model that asked for it.
    expect(result.current.messages).toEqual([])

    act(() => {
      result.current.updateConfig('model', CHAT_MODEL)
    })

    expect(result.current.messages).toEqual([
      assistantMessage('reply from the first model'),
    ])
  })

  test('defaults an untargeted write to the selected model', () => {
    const { result } = renderHook(() => usePlaygroundState())

    act(() => {
      result.current.updateConfig('model', OTHER_MODEL)
    })

    act(() => {
      result.current.updateMessages(() => [assistantMessage('edited in place')])
    })

    expect(result.current.messages).toEqual([
      assistantMessage('edited in place'),
    ])
  })

  test('keeps the two transcripts separate', () => {
    const { result } = renderHook(() => usePlaygroundState())

    act(() => {
      result.current.updateMessages(
        () => [assistantMessage('for the other model')],
        OTHER_MODEL
      )
      result.current.updateMessages(() => [assistantMessage('for the active')])
    })

    expect(result.current.messages).toEqual([
      assistantMessage('for the active'),
    ])

    act(() => {
      result.current.updateConfig('model', OTHER_MODEL)
    })

    expect(result.current.messages).toEqual([
      assistantMessage('for the other model'),
    ])
  })
})
