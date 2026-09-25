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

describe('frame parsing', () => {
  test('reads each pinned frame type off the wire', () => {
    expect(parseCopilotFrame('{"type":"text","text":"hi"}')).toEqual({
      type: 'text',
      text: 'hi',
    })
    expect(
      parseCopilotFrame(
        '{"type":"tool_start","tool_name":"query_logs","tool_args":{"n":1},"tool_call_id":"c1"}'
      )
    ).toEqual({
      type: 'tool_start',
      tool_name: 'query_logs',
      tool_args: { n: 1 },
      tool_call_id: 'c1',
    })
    expect(
      parseCopilotFrame(
        '{"type":"tool_end","tool_call_id":"c1","duration_ms":12,"ok":true}'
      )
    ).toEqual({
      type: 'tool_end',
      tool_call_id: 'c1',
      duration_ms: 12,
      ok: true,
    })
    expect(
      parseCopilotFrame(
        '{"type":"usage","prompt_tokens":10,"completion_tokens":2}'
      )
    ).toEqual({ type: 'usage', prompt_tokens: 10, completion_tokens: 2 })
    expect(parseCopilotFrame('{"type":"done"}')).toEqual({ type: 'done' })
    expect(parseCopilotFrame('{"type":"error","text":"boom"}')).toEqual({
      type: 'error',
      text: 'boom',
    })
  })

  test('carries error_text through on a failed tool_end', () => {
    expect(
      parseCopilotFrame(
        '{"type":"tool_end","tool_call_id":"c1","duration_ms":5,"ok":false,"error_text":"no rows"}'
      )
    ).toEqual({
      type: 'tool_end',
      tool_call_id: 'c1',
      duration_ms: 5,
      ok: false,
      error_text: 'no rows',
    })
  })

  test('treats a tool_end without ok as a failure', () => {
    expect(
      parseCopilotFrame('{"type":"tool_end","tool_call_id":"c1"}')
    ).toMatchObject({ ok: false, duration_ms: 0 })
  })

  test('accepts the bare [DONE] sentinel as a done frame', () => {
    expect(parseCopilotFrame('[DONE]')).toEqual({ type: 'done' })
  })

  test('returns null for payloads that are not frames', () => {
    expect(parseCopilotFrame('')).toBeNull()
    expect(parseCopilotFrame('   ')).toBeNull()
    expect(parseCopilotFrame('not json')).toBeNull()
    expect(parseCopilotFrame('{"type":"text"')).toBeNull()
    expect(parseCopilotFrame('null')).toBeNull()
    expect(parseCopilotFrame('{"type":"heartbeat"}')).toBeNull()
  })
})
