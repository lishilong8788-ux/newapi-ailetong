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
import { afterEach, describe, expect, test, vi } from 'vitest'

import { STORAGE_KEYS } from '../../constants'
import type { Message, PlaygroundConversations } from '../../types'
import { loadConversations, saveConversations } from '../storage/storage'
import {
  MAX_STORED_CONVERSATIONS,
  MAX_STORED_IMAGE_CHARS,
} from '../storage/storage-schema'

const MODEL = 'gpt-4o'

function imageDataUrl(chars: number): string {
  return `data:image/webp;base64,${'A'.repeat(chars)}`
}

function userMessage(key: string, images?: string[]): Message {
  return {
    key,
    from: 'user',
    versions: [{ id: `${key}-v1`, content: `text for ${key}` }],
    ...(images ? { images } : {}),
  }
}

function conversation(
  messages: Message[],
  updatedAt: number
): PlaygroundConversations[string] {
  return { messages, updatedAt }
}

afterEach(() => {
  localStorage.clear()
})

describe('saveConversations with image attachments', () => {
  test('round-trips an attached image through localStorage', () => {
    const image = imageDataUrl(64)

    saveConversations({ [MODEL]: conversation([userMessage('a', [image])], 1) })

    expect(loadConversations(MODEL)[MODEL].messages[0].images).toEqual([image])
  })

  test('drops attachments from older messages once the image budget is exceeded', () => {
    const large = imageDataUrl(Math.round(MAX_STORED_IMAGE_CHARS * 0.6))

    saveConversations({
      [MODEL]: conversation(
        [userMessage('older', [large]), userMessage('newer', [large])],
        1
      ),
    })

    const loaded = loadConversations(MODEL)[MODEL].messages
    expect(loaded.map((message) => message.key)).toEqual(['older', 'newer'])
    expect(loaded[0].images).toBeUndefined()
    expect(loaded[1].images).toEqual([large])
  })

  test('keeps message text when the quota rejects the write with attachments', () => {
    const image = imageDataUrl(64)
    // jsdom proxies the localStorage instance, so a spy installed on it never
    // intercepts the call. Patch the prototype method instead.
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })

    saveConversations({
      'older-model': conversation([userMessage('old', [image])], 1),
      [MODEL]: conversation([userMessage('a', [image])], 2),
    })
    setItem.mockRestore()

    // Retry 2 keeps the newest transcript's attachments and strips the rest, so
    // the older model loses the image while both keep their text.
    const stored = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS)
    expect(stored).toContain('text for old')
    expect(stored).toContain('text for a')

    const loaded = loadConversations(MODEL)
    expect(loaded['older-model'].messages[0].images).toBeUndefined()
    expect(loaded[MODEL].messages[0].images).toEqual([image])
  })
})

describe('per-model conversations', () => {
  test('keeps each model transcript separate', () => {
    saveConversations({
      'gpt-4o': conversation([userMessage('from-gpt')], 2),
      'claude-sonnet-4': conversation([userMessage('from-claude')], 1),
    })

    const loaded = loadConversations('gpt-4o')
    expect(loaded['gpt-4o'].messages.map((m) => m.key)).toEqual(['from-gpt'])
    expect(loaded['claude-sonnet-4'].messages.map((m) => m.key)).toEqual([
      'from-claude',
    ])
  })

  test('evicts the least recently used transcripts beyond the cap', () => {
    const conversations: PlaygroundConversations = {}
    for (let index = 0; index < MAX_STORED_CONVERSATIONS + 3; index++) {
      conversations[`model-${index}`] = conversation(
        [userMessage(`key-${index}`)],
        index
      )
    }

    saveConversations(conversations)

    const loaded = loadConversations('model-0')
    expect(Object.keys(loaded)).toHaveLength(MAX_STORED_CONVERSATIONS)
    // `updatedAt` ascends with the index, so the three oldest are gone and the
    // newest survives.
    expect(loaded['model-0']).toBeUndefined()
    expect(loaded['model-2']).toBeUndefined()
    expect(loaded[`model-${MAX_STORED_CONVERSATIONS + 2}`]).toBeDefined()
  })

  test('drops a model whose transcript was cleared', () => {
    saveConversations({ [MODEL]: conversation([userMessage('a')], 1) })
    saveConversations({ [MODEL]: conversation([], 2) })

    expect(loadConversations(MODEL)[MODEL]).toBeUndefined()
  })

  test('migrates the legacy single history into the active model once', () => {
    localStorage.setItem(
      STORAGE_KEYS.LEGACY_MESSAGES,
      JSON.stringify({ version: 1, data: [userMessage('legacy')] })
    )

    const migrated = loadConversations(MODEL)
    expect(migrated[MODEL].messages.map((m) => m.key)).toEqual(['legacy'])
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_MESSAGES)).toBeNull()

    // The migration is not persisted by the read itself, so a second load
    // without an intervening save finds nothing rather than re-importing.
    expect(loadConversations(MODEL)[MODEL]).toBeUndefined()
  })

  test('leaves an existing transcript untouched when a legacy history is present', () => {
    saveConversations({ [MODEL]: conversation([userMessage('current')], 5) })
    localStorage.setItem(
      STORAGE_KEYS.LEGACY_MESSAGES,
      JSON.stringify({ version: 1, data: [userMessage('legacy')] })
    )

    const loaded = loadConversations(MODEL)
    expect(loaded[MODEL].messages.map((m) => m.key)).toEqual(['current'])
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_MESSAGES)).toBeNull()
  })
})
