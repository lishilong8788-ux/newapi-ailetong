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

import { buildTurnsFromHistory } from '../lib/history'
import type { CopilotAssistantTurn, CopilotMessage } from '../types'

function message(overrides: Partial<CopilotMessage>): CopilotMessage {
  return {
    role: 'user',
    content: '',
    created_time: 1_700_000_000,
    ...overrides,
  }
}

describe('replaying a stored session', () => {
  test('folds an assistant tool round trip into one turn', () => {
    const turns = buildTurnsFromHistory([
      message({ role: 'user', content: 'Which channel is losing money?' }),
      message({
        role: 'assistant',
        content: 'Let me check.',
        tool_calls: [
          {
            id: 'call_1',
            function: {
              name: 'query_channel_cost',
              arguments: '{"days":30}',
            },
          },
        ],
      }),
      message({ role: 'tool', content: '[...]', tool_call_id: 'call_1' }),
      message({
        role: 'assistant',
        content: 'Channel 7 is.',
        prompt_tokens: 900,
        completion_tokens: 40,
      }),
    ])

    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant'])

    const assistant = turns[1] as CopilotAssistantTurn
    expect(assistant.blocks.map((block) => block.kind)).toEqual([
      'text',
      'tool',
      'text',
    ])
    expect(assistant.status).toBe('done')
    expect(assistant.usage).toEqual({ promptTokens: 900, completionTokens: 40 })

    const step = assistant.blocks[1]
    expect(step).toMatchObject({
      kind: 'tool',
      toolName: 'query_channel_cost',
      status: 'success',
      args: { days: 30 },
    })
    // Durations are not persisted, so a replayed step must not claim one.
    expect(step).not.toHaveProperty('durationMs')
  })

  test('starts a new turn at every user message', () => {
    const turns = buildTurnsFromHistory([
      message({ role: 'user', content: 'first' }),
      message({ role: 'assistant', content: 'a' }),
      message({ role: 'user', content: 'second' }),
      message({ role: 'assistant', content: 'b' }),
    ])

    expect(turns.map((turn) => turn.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
  })

  test('reports a tool call no tool row ever answered as failed', () => {
    const turns = buildTurnsFromHistory([
      message({ role: 'user', content: 'q' }),
      message({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', function: { name: 'query_logs' } }],
      }),
    ])

    const assistant = turns[1] as CopilotAssistantTurn
    expect(assistant.blocks[0]).toMatchObject({ kind: 'tool', status: 'error' })
  })

  test('drops system messages and empty assistant rows', () => {
    const turns = buildTurnsFromHistory([
      message({ role: 'system', content: 'you are an ops copilot' }),
      message({ role: 'user', content: 'q' }),
      message({ role: 'assistant', content: '' }),
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ role: 'user', text: 'q' })
  })

  test('returns nothing for an empty session', () => {
    expect(buildTurnsFromHistory([])).toEqual([])
  })

  // Reopening a session has to bring the screenshots back with it: the images are
  // part of what was asked, and a transcript that silently drops them makes the
  // assistant's answer read as if it came from nowhere.
  test('carries stored image paths onto the user turn', () => {
    const turns = buildTurnsFromHistory([
      message({
        role: 'user',
        content: 'which channel is losing money',
        images: ['12/a.webp', '12/b.png'],
      }),
    ])

    expect(turns[0]).toMatchObject({
      role: 'user',
      images: ['12/a.webp', '12/b.png'],
    })
  })

  // An image-only question is legal, so a turn with no text still has to exist.
  test('keeps an image-only user turn', () => {
    const turns = buildTurnsFromHistory([
      message({ role: 'user', content: '', images: ['12/a.webp'] }),
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ role: 'user', text: '' })
  })

  test('leaves images undefined when the row has none', () => {
    const turns = buildTurnsFromHistory([
      message({ role: 'user', content: 'q', images: null }),
    ])

    expect(turns[0]).toMatchObject({ role: 'user', images: undefined })
  })
})
