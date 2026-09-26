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
import { abandonTurn, reduceFrame } from '../lib/stream-reducer'
import { toToolArgEntries } from '../lib/tool-label'
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

describe('toToolArgEntries', () => {
  test('renders every value literally, including the falsy legal ones', () => {
    // The whole point of the dialog: what is on screen is what the tool receives.
    // Every one of these would render blank under a truthiness check, and `markup`
    // in particular is the field that decides what customers get charged.
    expect(
      toToolArgEntries({
        channel_id: 7,
        markup: 0,
        enabled: false,
        note: '',
        previous: null,
      })
    ).toEqual([
      { name: 'channel_id', value: '7' },
      { name: 'markup', value: '0' },
      { name: 'enabled', value: 'false' },
      { name: 'note', value: '' },
      { name: 'previous', value: 'null' },
    ])
  })

  test('keeps the order the model sent rather than sorting', () => {
    // Schema order reads as a sentence: the channel being changed, then the value
    // it is being changed to. Alphabetising would invert that.
    expect(
      toToolArgEntries({ channel_id: 7, markup: 0.3 })?.map((e) => e.name)
    ).toEqual(['channel_id', 'markup'])
  })

  test('returns null for anything that is not a plain object', () => {
    // The caller falls back to showing the raw payload. An argument list that
    // cannot be read as fields is exactly when the operator needs the literal
    // bytes rather than rows invented from them.
    expect(toToolArgEntries('not json at all')).toBeNull()
    expect(toToolArgEntries([1, 2])).toBeNull()
    expect(toToolArgEntries(null)).toBeNull()
    expect(toToolArgEntries(undefined)).toBeNull()
  })

  test('serialises a nested value instead of printing [object Object]', () => {
    expect(toToolArgEntries({ range: { from: 1, to: 2 } })).toEqual([
      { name: 'range', value: '{"from":1,"to":2}' },
    ])
  })
})

describe('a parked turn survives the stream closing', () => {
  test('abandonTurn leaves awaiting_confirmation alone', () => {
    // The gate ends the SSE stream, so `onSettled` fires and calls `abandonTurn`
    // on exactly the turn holding the proposal. If that ever started touching
    // non-streaming turns, the dialog would vanish in the same tick it appeared —
    // and the operator would be left with a turn that stopped for no visible
    // reason, which is the failure this whole surface exists to prevent.
    const parked = reduceFrame(streamingTurn(), {
      type: 'confirm_required',
      tool_name: 'set_channel_markup',
      tool_args: { channel_id: 3, markup: 0 },
      tool_call_id: 'c1',
    })

    expect(abandonTurn(parked)).toBe(parked)
    expect(abandonTurn(parked, 'connection lost')).toBe(parked)
  })

  test('a declined turn is terminal and keeps naming what it refused', () => {
    const declined: CopilotAssistantTurn = {
      ...reduceFrame(streamingTurn(), {
        type: 'confirm_required',
        tool_name: 'set_channel_markup',
        tool_args: { channel_id: 3, markup: 0 },
        tool_call_id: 'c1',
      }),
      status: 'declined',
    }

    expect(abandonTurn(declined)).toBe(declined)
    // Kept on purpose: the transcript has to say which write was turned down,
    // otherwise the turn reads as one that simply ended.
    expect(declined.pendingWrite?.toolName).toBe('set_channel_markup')
  })
})
