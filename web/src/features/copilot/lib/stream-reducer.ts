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
import type {
  CopilotAssistantTurn,
  CopilotBlock,
  CopilotFrame,
  CopilotToolBlock,
} from '../types'

export function createPendingTurn(id: string): CopilotAssistantTurn {
  return { role: 'assistant', id, blocks: [], status: 'streaming' }
}

/**
 * Tool arguments, parsed when they are a JSON document and passed through when
 * they are not.
 *
 * The contract types `tool_args` loosely, and both shapes are in play: a backend
 * that forwards the model's raw `function.arguments` sends a string, one that
 * unmarshals first sends an object. The disclosure renders whatever this returns,
 * so a string that fails to parse is still shown verbatim rather than dropped —
 * an unreadable argument list is evidence too.
 */
export function normalizeToolArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args

  const trimmed = args.trim()
  if (!trimmed) return trimmed

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return args
  }
}

/**
 * Folds one frame into the turn, returning a new turn.
 *
 * Append-only and arrival-ordered: phase 1 is not token streaming, so a turn is a
 * sequence of whole `text` chunks interleaved with tool steps, and the order they
 * arrived in *is* the narration ("let me check X" → step → "so the answer is Y").
 * Nothing here reorders or groups by kind.
 */
export function reduceFrame(
  turn: CopilotAssistantTurn,
  frame: CopilotFrame
): CopilotAssistantTurn {
  switch (frame.type) {
    case 'text':
      return appendText(turn, frame.text)
    case 'tool_start':
      return appendToolStart(
        turn,
        frame.tool_call_id,
        frame.tool_name,
        frame.tool_args
      )
    case 'tool_end':
      return applyToolEnd(turn, frame)
    case 'usage':
      return {
        ...turn,
        usage: {
          promptTokens: frame.prompt_tokens,
          completionTokens: frame.completion_tokens,
        },
      }
    case 'done':
      // An error already reported is the turn's outcome; `done` closing the
      // stream afterwards must not relabel it as a success.
      return turn.status === 'error' ? turn : { ...turn, status: 'done' }
    case 'error':
      return { ...turn, status: 'error', errorText: frame.text }
    default:
      return turn
  }
}

export function reduceFrames(
  turn: CopilotAssistantTurn,
  frames: CopilotFrame[]
): CopilotAssistantTurn {
  return frames.reduce(reduceFrame, turn)
}

/**
 * Consecutive `text` frames merge into the block they continue.
 *
 * The model narrates in fragments between tool calls, and the split points are an
 * artefact of how the backend flushed, not paragraph boundaries — concatenating
 * keeps markdown that straddles two frames renderable. A tool step in between
 * ends the block, which is what makes the "said, checked, said" shape visible.
 */
function appendText(
  turn: CopilotAssistantTurn,
  text: string
): CopilotAssistantTurn {
  if (!text) return turn

  const last = turn.blocks.at(-1)
  if (last?.kind === 'text') {
    const merged: CopilotBlock = { ...last, text: last.text + text }
    return { ...turn, blocks: [...turn.blocks.slice(0, -1), merged] }
  }

  return {
    ...turn,
    blocks: [
      ...turn.blocks,
      { kind: 'text', id: `text-${turn.blocks.length}`, text },
    ],
  }
}

function appendToolStart(
  turn: CopilotAssistantTurn,
  toolCallId: string,
  toolName: string,
  args: unknown
): CopilotAssistantTurn {
  const block: CopilotToolBlock = {
    kind: 'tool',
    // Position-derived rather than the call id: the id is the join key for
    // `tool_end`, but nothing guarantees the backend never reuses one, and a
    // duplicate React key silently drops a step from a verification surface.
    id: `tool-${turn.blocks.length}`,
    toolCallId,
    toolName,
    args: normalizeToolArgs(args),
    status: 'running',
  }
  return { ...turn, blocks: [...turn.blocks, block] }
}

/**
 * Settles the step `tool_call_id` refers to.
 *
 * Matches the last still-running block with that id so a reused id resolves the
 * call actually in flight. An id with no open step appends a settled one instead
 * of being dropped: the tool did run, and a step missing from this list would
 * read as the copilot having answered without querying anything.
 */
function applyToolEnd(
  turn: CopilotAssistantTurn,
  frame: Extract<CopilotFrame, { type: 'tool_end' }>
): CopilotAssistantTurn {
  const settled = {
    status: frame.ok ? ('success' as const) : ('error' as const),
    durationMs: frame.duration_ms,
    ...(frame.error_text ? { errorText: frame.error_text } : {}),
  }

  let index = -1
  for (let cursor = turn.blocks.length - 1; cursor >= 0; cursor -= 1) {
    const block = turn.blocks[cursor]
    if (
      block.kind === 'tool' &&
      block.toolCallId === frame.tool_call_id &&
      block.status === 'running'
    ) {
      index = cursor
      break
    }
  }

  if (index === -1) {
    return {
      ...turn,
      blocks: [
        ...turn.blocks,
        {
          kind: 'tool',
          id: `tool-${turn.blocks.length}`,
          toolCallId: frame.tool_call_id,
          toolName: frame.tool_call_id,
          args: undefined,
          ...settled,
        },
      ],
    }
  }

  const blocks = [...turn.blocks]
  blocks[index] = { ...(blocks[index] as CopilotToolBlock), ...settled }
  return { ...turn, blocks }
}

/**
 * Closes a turn the transport could not finish.
 *
 * Used by both the stop button and a dropped connection: a step left `running`
 * would spin forever, and a spinner is a claim that work is still happening.
 */
export function abandonTurn(
  turn: CopilotAssistantTurn,
  errorText?: string
): CopilotAssistantTurn {
  if (turn.status !== 'streaming') return turn

  return {
    ...turn,
    status: errorText ? 'error' : 'done',
    ...(errorText ? { errorText } : {}),
    blocks: turn.blocks.map((block) =>
      block.kind === 'tool' && block.status === 'running'
        ? { ...block, status: 'error' as const }
        : block
    ),
  }
}
