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
  abandonTurn,
  createPendingTurn,
  reduceFrames,
} from '../lib/stream-reducer'
import type { CopilotFrame, CopilotToolBlock } from '../types'

const TURN_ID = 'turn-1'

function toolBlocks(blocks: { kind: string }[]): CopilotToolBlock[] {
  return blocks.filter(
    (block): block is CopilotToolBlock => block.kind === 'tool'
  )
}

describe('interleaved turn assembly', () => {
  test('keeps text and tool steps in arrival order as separate blocks', () => {
    const frames: CopilotFrame[] = [
      { type: 'text', text: 'Let me check the ledger.' },
      {
        type: 'tool_start',
        tool_name: 'query_cost_overview',
        tool_args: { days: 30 },
        tool_call_id: 'call_1',
      },
      { type: 'tool_end', tool_call_id: 'call_1', duration_ms: 412, ok: true },
      { type: 'text', text: 'Gross margin was 31%.' },
      { type: 'usage', prompt_tokens: 1200, completion_tokens: 80 },
      { type: 'done' },
    ]

    const turn = reduceFrames(createPendingTurn(TURN_ID), frames)

    expect(turn.blocks.map((block) => block.kind)).toEqual([
      'text',
      'tool',
      'text',
    ])
    expect(turn.status).toBe('done')
    expect(turn.usage).toEqual({ promptTokens: 1200, completionTokens: 80 })

    const [step] = toolBlocks(turn.blocks)
    expect(step.toolName).toBe('query_cost_overview')
    expect(step.status).toBe('success')
    expect(step.durationMs).toBe(412)
    expect(step.args).toEqual({ days: 30 })
  })

  test('merges consecutive text frames into one block', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      { type: 'text', text: 'Margin is ' },
      { type: 'text', text: '31%.' },
    ])

    expect(turn.blocks).toHaveLength(1)
    expect(turn.blocks[0]).toMatchObject({
      kind: 'text',
      text: 'Margin is 31%.',
    })
  })

  test('starts a new text block after a tool step splits the narration', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      { type: 'text', text: 'Checking.' },
      { type: 'tool_start', tool_name: 'query_logs', tool_call_id: 'c1' },
      { type: 'tool_end', tool_call_id: 'c1', duration_ms: 10, ok: true },
      { type: 'text', text: 'Done.' },
    ])

    expect(turn.blocks.map((block) => block.kind)).toEqual([
      'text',
      'tool',
      'text',
    ])
  })

  test('leaves a step running until its tool_end arrives', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      { type: 'tool_start', tool_name: 'query_logs', tool_call_id: 'c1' },
    ])

    expect(toolBlocks(turn.blocks)[0].status).toBe('running')
    expect(turn.status).toBe('streaming')
  })

  test('parses tool_args delivered as a JSON string', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      {
        type: 'tool_start',
        tool_name: 'query_model_price',
        tool_args: '{"model":"gpt-5.5"}',
        tool_call_id: 'c1',
      },
    ])

    expect(toolBlocks(turn.blocks)[0].args).toEqual({ model: 'gpt-5.5' })
  })

  test('keeps unparseable tool_args as the raw string', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      {
        type: 'tool_start',
        tool_name: 'query_model_price',
        tool_args: '{model: gpt-5.5',
        tool_call_id: 'c1',
      },
    ])

    expect(toolBlocks(turn.blocks)[0].args).toBe('{model: gpt-5.5')
  })

  test('routes each tool_end to the step that opened with its id', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      { type: 'tool_start', tool_name: 'a', tool_call_id: 'c1' },
      { type: 'tool_start', tool_name: 'b', tool_call_id: 'c2' },
      { type: 'tool_end', tool_call_id: 'c2', duration_ms: 20, ok: true },
      { type: 'tool_end', tool_call_id: 'c1', duration_ms: 90, ok: true },
    ])

    const steps = toolBlocks(turn.blocks)
    expect(steps.map((step) => [step.toolName, step.durationMs])).toEqual([
      ['a', 90],
      ['b', 20],
    ])
  })
})

describe('failure paths', () => {
  test('marks the step failed and records the error on tool_end ok:false', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      {
        type: 'tool_start',
        tool_name: 'query_channel_cost',
        tool_call_id: 'c1',
      },
      {
        type: 'tool_end',
        tool_call_id: 'c1',
        duration_ms: 1500,
        ok: false,
        error_text: 'channel 7 has no cost price',
      },
      { type: 'text', text: 'I could not price that channel.' },
      { type: 'done' },
    ])

    const [step] = toolBlocks(turn.blocks)
    expect(step.status).toBe('error')
    expect(step.errorText).toBe('channel 7 has no cost price')
    expect(step.durationMs).toBe(1500)
    // A failed step is not a failed turn: the model still gets to explain.
    expect(turn.status).toBe('done')
  })

  test('an error frame mid-stream ends the turn and keeps earlier blocks', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      { type: 'text', text: 'Looking at last month.' },
      { type: 'tool_start', tool_name: 'query_cost_trend', tool_call_id: 'c1' },
      { type: 'error', text: 'upstream returned 503' },
    ])

    expect(turn.status).toBe('error')
    expect(turn.errorText).toBe('upstream returned 503')
    expect(turn.blocks.map((block) => block.kind)).toEqual(['text', 'tool'])
  })

  test('a done frame after an error does not relabel the turn as successful', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      { type: 'error', text: 'upstream returned 503' },
      { type: 'done' },
    ])

    expect(turn.status).toBe('error')
    expect(turn.errorText).toBe('upstream returned 503')
  })

  test('records a tool_end with no matching open step rather than dropping it', () => {
    const turn = reduceFrames(createPendingTurn(TURN_ID), [
      {
        type: 'tool_end',
        tool_call_id: 'orphan_call',
        duration_ms: 33,
        ok: true,
      },
    ])

    const [step] = toolBlocks(turn.blocks)
    expect(step.toolCallId).toBe('orphan_call')
    expect(step.status).toBe('success')
    expect(step.durationMs).toBe(33)
  })
})

describe('abandoning a turn', () => {
  test('stopping mid-stream settles running steps so no spinner survives', () => {
    const streaming = reduceFrames(createPendingTurn(TURN_ID), [
      { type: 'text', text: 'Checking.' },
      { type: 'tool_start', tool_name: 'query_logs', tool_call_id: 'c1' },
    ])

    const stopped = abandonTurn(streaming)

    expect(stopped.status).toBe('done')
    expect(toolBlocks(stopped.blocks)[0].status).toBe('error')
  })

  test('a transport failure records its message on the turn', () => {
    const stopped = abandonTurn(
      createPendingTurn(TURN_ID),
      'The copilot connection closed unexpectedly.'
    )

    expect(stopped.status).toBe('error')
    expect(stopped.errorText).toBe(
      'The copilot connection closed unexpectedly.'
    )
  })

  test('leaves an already finished turn untouched', () => {
    const finished = reduceFrames(createPendingTurn(TURN_ID), [
      { type: 'text', text: 'Done.' },
      { type: 'done' },
    ])

    expect(abandonTurn(finished)).toBe(finished)
  })
})
