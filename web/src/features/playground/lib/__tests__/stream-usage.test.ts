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

import {
  parseStreamMessageUpdates,
  parseStreamUsage,
} from '../streaming/stream-utils'

/** The closing frame the relay synthesises before `[DONE]`. */
const USAGE_FRAME = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  choices: [],
  usage: { prompt_tokens: 12, completion_tokens: 83, total_tokens: 95 },
})

const CONTENT_FRAME = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
})

describe('parseStreamUsage', () => {
  test('reads the closing usage frame', () => {
    expect(parseStreamUsage(USAGE_FRAME)).toEqual({
      prompt_tokens: 12,
      completion_tokens: 83,
      total_tokens: 95,
    })
  })

  /**
   * The regression this parser exists for. The usage frame carries an empty
   * `choices`, so the message parser sees nothing in it and returns `[]` — which
   * is why reading usage from that path silently dropped every token count.
   */
  test('reads the frame the message parser treats as empty', () => {
    expect(parseStreamMessageUpdates(USAGE_FRAME)).toEqual([])
    expect(parseStreamUsage(USAGE_FRAME)).toBeDefined()
  })

  test('finds nothing in a content frame', () => {
    expect(parseStreamUsage(CONTENT_FRAME)).toBeUndefined()
  })

  test('treats an all-zero report as no report', () => {
    const frame = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    expect(parseStreamUsage(frame)).toBeUndefined()
  })

  test('keeps a partial report', () => {
    const frame = JSON.stringify({ choices: [], usage: { total_tokens: 95 } })

    expect(parseStreamUsage(frame)).toEqual({ total_tokens: 95 })
  })

  /** A malformed frame is the message parser's error to report, not this one's. */
  test('stays quiet on malformed JSON', () => {
    expect(parseStreamUsage('{ not json')).toBeUndefined()
    expect(() => parseStreamMessageUpdates('{ not json')).toThrow()
  })
})
