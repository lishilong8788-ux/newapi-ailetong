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
import { TOOL_LABEL_KEYS } from '../constants'

/**
 * The i18n key for a tool's display name, or the raw name when it has none.
 *
 * Returning the identifier for unmapped tools is deliberate: `t()` echoes a key it
 * cannot resolve, so a backend that ships a new tool before this table learns
 * about it still renders something specific and greppable.
 */
export function getToolLabelKey(toolName: string): string {
  return TOOL_LABEL_KEYS[toolName] ?? toolName
}

/** Step duration, in the coarsest unit that still reads as a measurement. */
export function formatToolDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return ''
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`

  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 2 : 1)}s`
}

/** Pretty-printed arguments for the disclosure, with a readable empty case. */
export function formatToolArgs(args: unknown): string {
  if (args === undefined || args === null) return '{}'
  if (typeof args === 'string') return args

  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

export interface ToolArgEntry {
  name: string
  value: string
}

/**
 * One row per argument, for the confirmation dialog.
 *
 * Returns `null` when the arguments are not a plain object — a string the backend
 * could not parse, an array, a bare number. The caller then shows the raw text
 * instead of inventing rows: an argument list that does not have the expected
 * shape is exactly the case where the operator must see the literal payload.
 *
 * Insertion order is kept rather than sorted. The model emits arguments in the
 * order the schema declares them, which reads as a sentence (`channel_id` then
 * `markup`); alphabetising would put the value being set before the thing it is
 * being set on.
 */
export function toToolArgEntries(args: unknown): ToolArgEntry[] | null {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return null
  }

  return Object.entries(args as Record<string, unknown>).map(
    ([name, value]) => ({ name, value: formatToolArgValue(value) })
  )
}

/**
 * One argument value, rendered literally.
 *
 * Every branch is an explicit type test, never a truthiness check: `0`, `false`
 * and `''` are all legal values here, and `markup: 0` in particular means
 * break-even rather than "unset". Rendering it as blank would ask the operator to
 * approve a change whose number they cannot see.
 */
function formatToolArgValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
