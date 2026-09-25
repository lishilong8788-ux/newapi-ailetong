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
  CopilotMessage,
  CopilotToolBlock,
  CopilotTurn,
} from '../types'
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
import { normalizeToolArgs } from './stream-reducer'

/**
 * Replays stored messages into the same turn shape the stream produces.
 *
 * Storage is per message and rendering is per turn, so the fold is not one-to-one:
 * an assistant row carrying `tool_calls` opens steps that a later `role: 'tool'`
 * row closes, and the assistant rows between them are text blocks of the *same*
 * turn. A new turn starts only at a user message.
 *
 * Durations are absent here by design — the contract persists tokens, not
 * `duration_ms` — so a replayed step shows its name and outcome without a timing
 * it cannot know. Inventing one would be worse than omitting it.
 */
export function buildTurnsFromHistory(
  messages: CopilotMessage[]
): CopilotTurn[] {
  const turns: CopilotTurn[] = []
  let current: CopilotAssistantTurn | null = null

  const closeCurrent = () => {
    if (current && current.blocks.length > 0) turns.push(current)
    current = null
  }

  const ensureCurrent = (index: number): CopilotAssistantTurn => {
    if (!current) {
      current = {
        role: 'assistant',
        id: `history-assistant-${index}`,
        blocks: [],
        status: 'done',
      }
    }
    return current
  }

  messages.forEach((message, index) => {
    if (message.role === 'system') return

    if (message.role === 'user') {
      closeCurrent()
      turns.push({
        role: 'user',
        id: `history-user-${index}`,
        text: message.content ?? '',
        images: message.images ?? undefined,
      })
      return
    }

    if (message.role === 'tool') {
      const turn = ensureCurrent(index)
      current = { ...turn, blocks: settleToolBlock(turn.blocks, message) }
      return
    }

    const turn = ensureCurrent(index)
    const blocks = [...turn.blocks]

    if (message.content) {
      blocks.push({
        kind: 'text',
        id: `history-text-${index}`,
        text: message.content,
      })
    }

    for (const [callIndex, call] of (message.tool_calls ?? []).entries()) {
      blocks.push({
        kind: 'tool',
        id: `history-tool-${index}-${callIndex}`,
        toolCallId: call.id,
        toolName: call.function?.name || call.id,
        args: normalizeToolArgs(call.function?.arguments),
        status: 'running',
      })
    }

    current = {
      ...turn,
      blocks,
      usage: usageFromMessage(message) ?? turn.usage,
    }
  })

  closeCurrent()

  // Any step never answered by a tool row is reported as failed rather than left
  // spinning: the request that opened it is long over.
  return turns.map((turn) =>
    turn.role === 'assistant'
      ? {
          ...turn,
          blocks: turn.blocks.map((block) =>
            block.kind === 'tool' && block.status === 'running'
              ? { ...block, status: 'error' as const }
              : block
          ),
        }
      : turn
  )
}

function settleToolBlock(
  blocks: CopilotBlock[],
  message: CopilotMessage
): CopilotBlock[] {
  const next = [...blocks]

  for (let cursor = next.length - 1; cursor >= 0; cursor -= 1) {
    const block = next[cursor]
    if (
      block.kind === 'tool' &&
      block.status === 'running' &&
      (!message.tool_call_id || block.toolCallId === message.tool_call_id)
    ) {
      next[cursor] = { ...(block as CopilotToolBlock), status: 'success' }
      return next
    }
  }

  return next
}

function usageFromMessage(message: CopilotMessage) {
  if (!message.prompt_tokens && !message.completion_tokens) return undefined

  return {
    promptTokens: message.prompt_tokens ?? 0,
    completionTokens: message.completion_tokens ?? 0,
  }
}
