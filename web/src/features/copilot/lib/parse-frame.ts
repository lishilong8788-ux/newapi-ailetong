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
import type { CopilotFrame } from '../types'

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * One SSE `data:` payload turned into a frame, or `null` when it is not one.
 *
 * Returns `null` rather than throwing for anything unrecognised — a keep-alive, a
 * frame type added by a newer backend, a truncated line. Dropping an unknown frame
 * leaves the turn intact; throwing here would abort a stream over a comment.
 */
export function parseCopilotFrame(data: string): CopilotFrame | null {
  const trimmed = data.trim()
  if (!trimmed) return null
  // Not in the pinned contract, but every SSE producer in this repo terminates
  // with it and a stream that ends without a `done` frame would leave the
  // composer stuck on its stop button.
  if (trimmed === '[DONE]') return { type: 'done' }

  let payload: unknown
  try {
    payload = JSON.parse(trimmed)
  } catch {
    return null
  }

  if (typeof payload !== 'object' || payload === null) return null
  const frame = payload as Record<string, unknown>

  switch (frame.type) {
    case 'text':
      return { type: 'text', text: asString(frame.text) }
    case 'tool_start':
      return {
        type: 'tool_start',
        tool_name: asString(frame.tool_name),
        tool_args: frame.tool_args,
        tool_call_id: asString(frame.tool_call_id),
      }
    case 'tool_end':
      return {
        type: 'tool_end',
        tool_call_id: asString(frame.tool_call_id),
        duration_ms: asNumber(frame.duration_ms),
        // Absent `ok` counts as a failure: a step that cannot state it succeeded
        // must not be drawn with a check mark on a surface whose whole job is
        // showing whether the copilot really queried the system.
        ok: frame.ok === true,
        ...(typeof frame.error_text === 'string'
          ? { error_text: frame.error_text }
          : {}),
      }
    case 'usage':
      return {
        type: 'usage',
        prompt_tokens: asNumber(frame.prompt_tokens),
        completion_tokens: asNumber(frame.completion_tokens),
      }
    case 'done':
      return { type: 'done' }
    case 'error':
      return { type: 'error', text: asString(frame.text) }
    default:
      return null
  }
}
