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
import type { Message } from '../../types'
import { loadMessages, saveMessages } from '../storage/storage'
import { MAX_STORED_IMAGE_CHARS } from '../storage/storage-schema'

function imageDataUrl(chars: number): string {
  return `data:image/webp;base64,${'A'.repeat(chars)}`
}

function userMessage(key: string, images: string[]): Message {
  return {
    key,
    from: 'user',
    versions: [{ id: `${key}-v1`, content: `text for ${key}` }],
    images,
  }
}

afterEach(() => {
  localStorage.clear()
})

describe('saveMessages with image attachments', () => {
  test('round-trips an attached image through localStorage', () => {
    const image = imageDataUrl(64)

    saveMessages([userMessage('a', [image])])

    expect(loadMessages()?.[0].images).toEqual([image])
  })

  test('drops attachments from older messages once the image budget is exceeded', () => {
    const large = imageDataUrl(Math.round(MAX_STORED_IMAGE_CHARS * 0.6))

    saveMessages([userMessage('older', [large]), userMessage('newer', [large])])

    const loaded = loadMessages()
    expect(loaded?.map((message) => message.key)).toEqual(['older', 'newer'])
    expect(loaded?.[0].images).toBeUndefined()
    expect(loaded?.[1].images).toEqual([large])
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

    saveMessages([userMessage('a', [image])])
    setItem.mockRestore()

    const stored = localStorage.getItem(STORAGE_KEYS.MESSAGES)
    expect(stored).toContain('text for a')
    expect(stored).not.toContain(image)
    expect(loadMessages()?.[0].images).toBeUndefined()
  })
})
