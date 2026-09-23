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
import { ERROR_MESSAGES } from '../../constants'
import type { ChatCompletionChunk, Message } from '../../types'

const STREAM_DONE_MESSAGE = '[DONE]'
const STREAM_CLOSED_READY_STATE = 2

export type StreamUpdateType = 'reasoning' | 'content'

export type StreamMessageUpdate = {
  type: StreamUpdateType
  chunk: string
}

type StreamErrorPayload = {
  error?: {
    code?: string
    message?: string
  }
}

export type StreamErrorDetails = {
  errorCode?: string
  errorMessage: string
}

export function parseStreamErrorDetails(data?: string): StreamErrorDetails {
  const fallbackMessage = data || ERROR_MESSAGES.API_REQUEST_ERROR

  if (!data) {
    return { errorMessage: fallbackMessage }
  }

  try {
    const parsed = JSON.parse(data) as StreamErrorPayload

    if (!parsed?.error) {
      return { errorMessage: fallbackMessage }
    }

    return {
      errorCode: parsed.error.code || undefined,
      errorMessage: parsed.error.message || fallbackMessage,
    }
  } catch {
    return { errorMessage: fallbackMessage }
  }
}

export function parseStreamMessageUpdates(data: string): StreamMessageUpdate[] {
  const chunk = JSON.parse(data) as ChatCompletionChunk
  const delta = chunk.choices?.[0]?.delta

  if (!delta) {
    return []
  }

  const updates: StreamMessageUpdate[] = []

  if (delta.reasoning_content) {
    updates.push({ type: 'reasoning', chunk: delta.reasoning_content })
  }

  if (delta.content) {
    updates.push({ type: 'content', chunk: delta.content })
  }

  return updates
}

/**
 * Token counts from a stream's final usage chunk, if this frame is one.
 *
 * A separate pass rather than another `StreamMessageUpdate` variant, because
 * usage is not an update to the message text and every consumer of that union
 * would have to learn to ignore it.
 *
 * The frame this reads is why `parseStreamMessageUpdates` cannot: the relay
 * synthesises a closing chunk whose `choices` is empty and whose `usage` is the
 * whole payload, so that function's `if (!delta) return []` bails before ever
 * reaching it. Both run over each frame; at most one of them finds anything.
 *
 * Nothing needs to be requested for this to arrive — the relay defaults
 * `includeUsage` to true and only honours `stream_options` when the client sends
 * one, which the playground does not.
 */
export function parseStreamUsage(data: string): Message['usage'] {
  let chunk: { usage?: Message['usage'] }
  try {
    chunk = JSON.parse(data) as { usage?: Message['usage'] }
  } catch {
    // Malformed frames are the message parser's problem to report; a missing
    // token count must not turn into a failed reply.
    return undefined
  }

  const usage = chunk?.usage
  if (!usage) {
    return undefined
  }

  // An upstream may report the totals without the split, or send an all-zero
  // object on a request that produced nothing. Neither is worth a row.
  const hasAnyCount = [
    usage.prompt_tokens,
    usage.completion_tokens,
    usage.total_tokens,
  ].some((count) => typeof count === 'number' && count > 0)

  return hasAnyCount ? usage : undefined
}

export function isStreamDoneMessage(data: string): boolean {
  return data === STREAM_DONE_MESSAGE
}

export function isStreamClosedReadyState(readyState?: number): boolean {
  return readyState === STREAM_CLOSED_READY_STATE
}

export function getStreamReadyStateError(
  eventReadyState: number | undefined,
  source: unknown
): string | null {
  const status = (source as { status?: number }).status

  if (
    eventReadyState !== undefined &&
    eventReadyState >= STREAM_CLOSED_READY_STATE &&
    status !== undefined &&
    status !== 200
  ) {
    return `HTTP ${status}: ${ERROR_MESSAGES.CONNECTION_CLOSED}`
  }

  return null
}
