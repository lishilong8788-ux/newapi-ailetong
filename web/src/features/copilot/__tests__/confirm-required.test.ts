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

import { parseCopilotFrame } from '../lib/parse-frame'
import { reduceFrame } from '../lib/stream-reducer'
import type { CopilotAssistantTurn } from '../types'

const streamingTurn = (): CopilotAssistantTurn => ({
  role: 'assistant',
  id: 'a1',
  blocks: [],
  status: 'streaming',
})

describe('confirm_required', () => {
  test('carries the tool name and the literal args off the wire', () => {
    expect(
      parseCopilotFrame(
        '{"type":"confirm_required","tool_name":"set_channel_markup","tool_args":{"channel_id":3,"markup":0.3},"tool_call_id":"c1"}'
      )
    ).toEqual({
      type: 'confirm_required',
      tool_name: 'set_channel_markup',
      tool_args: { channel_id: 3, markup: 0.3 },
      tool_call_id: 'c1',
    })
  })

  test('parks the turn awaiting confirmation instead of finishing it', () => {
    const turn = reduceFrame(streamingTurn(), {
      type: 'confirm_required',
      tool_name: 'set_channel_markup',
      tool_args: { channel_id: 3, markup: 0 },
      tool_call_id: 'c1',
    })

    // Not 'done': the write has not happened, and drawing a finished turn over a
    // pending one is the failure this status exists to prevent.
    expect(turn.status).toBe('awaiting_confirmation')
    expect(turn.pendingWrite).toEqual({
      toolName: 'set_channel_markup',
      args: { channel_id: 3, markup: 0 },
      toolCallId: 'c1',
    })
    // Nothing ran, so nothing belongs in the transcript yet.
    expect(turn.blocks).toHaveLength(0)
  })

  test('keeps a markup of 0 rather than dropping it as falsy', () => {
    const turn = reduceFrame(streamingTurn(), {
      type: 'confirm_required',
      tool_name: 'set_channel_markup',
      tool_args: { channel_id: 3, markup: 0 },
      tool_call_id: 'c1',
    })

    // 0 means break-even, a legal setting. A dialog that renders it as blank
    // would ask the operator to approve a change whose value they cannot see.
    expect(
      (turn.pendingWrite?.args as { markup: number } | undefined)?.markup
    ).toBe(0)
  })

  test('parses stringified args the way tool steps do', () => {
    const turn = reduceFrame(streamingTurn(), {
      type: 'confirm_required',
      tool_name: 'set_channel_markup',
      tool_args: '{"channel_id":7,"markup":1.5}',
      tool_call_id: 'c2',
    })

    expect(turn.pendingWrite?.args).toEqual({ channel_id: 7, markup: 1.5 })
  })
})
