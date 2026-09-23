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
import { z } from 'zod'

export const STORAGE_VERSION = 1
export const MAX_STORED_MESSAGES = 100
/** Raised from 1 MiB so image attachments do not evict the whole history. */
export const MAX_STORED_MESSAGES_BYTES = 3 * 1024 * 1024
/**
 * How many models keep a transcript. Beyond this the least recently used are
 * dropped: the model list runs to several hundred entries and a browsing session
 * can touch dozens, but nobody returns to the twentieth one back. The cap is on
 * transcripts rather than bytes because `MAX_STORED_MESSAGES_BYTES` already
 * bounds the payload — this bounds how thinly that budget gets divided.
 */
export const MAX_STORED_CONVERSATIONS = 12
export const MAX_LOADED_MESSAGES_CHARS = 120_000
export const MAX_LOADED_MESSAGE_CHARS = 40_000
/**
 * Image data URLs are kept for the newest messages only; older attachments are
 * dropped while their text is preserved.
 */
export const MAX_STORED_IMAGE_CHARS = 1_500_000

/**
 * `.strip()` (the default) matters here: rows written before the sampling block
 * was removed still carry `temperature`, `top_p`, `max_tokens` and `seed`, and
 * parsing drops them instead of failing, so a returning user's stored model and
 * group survive.
 */
export const playgroundConfigSchema = z.object({
  model: z.string().optional(),
  group: z.string().optional(),
  stream: z.boolean().optional(),
  /**
   * Positive integer only. A stored `0` or a negative id would reach the relay
   * as a pinned channel that cannot exist, so an out-of-range value is dropped
   * back to automatic routing rather than carried into a request.
   */
  channelId: z.number().int().positive().optional(),
})

const messageRoleSchema = z.enum(['user', 'assistant', 'system'])
const messageStatusSchema = z.enum([
  'loading',
  'streaming',
  'complete',
  'error',
])

const messageVersionSchema = z.object({
  id: z.string(),
  content: z.string(),
})

const sourceSchema = z.object({
  href: z.string(),
  title: z.string(),
})

const reasoningSchema = z.object({
  content: z.string(),
  duration: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  durationMs: z.number().optional(),
})

const messageSchema = z.object({
  key: z.string(),
  from: messageRoleSchema,
  versions: z.array(messageVersionSchema).min(1),
  images: z.array(z.string()).optional(),
  results: z.array(z.string()).optional(),
  createdAt: z.number().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  durationMs: z.number().optional(),
  /**
   * Persisted, because comparing channels is the reason this is recorded and a
   * comparison spans more than one sitting. Omitted here, a restored streamed
   * reply came back indistinguishable from a non-streamed one — the debug panel
   * read the absence as "no first token exists" and said so.
   */
  channel: z
    .object({
      id: z.number().int().positive(),
      code: z.string().optional(),
      pinned: z.boolean(),
    })
    .optional(),
  ttftMs: z.number().nonnegative().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative().optional(),
      completion_tokens: z.number().nonnegative().optional(),
      total_tokens: z.number().nonnegative().optional(),
    })
    .optional(),
  requestId: z.string().optional(),
  sources: z.array(sourceSchema).optional(),
  reasoning: reasoningSchema.optional(),
  isReasoningStreaming: z.boolean().optional(),
  isReasoningComplete: z.boolean().optional(),
  isContentComplete: z.boolean().optional(),
  status: messageStatusSchema.optional(),
  errorCode: z.string().nullable().optional(),
})

export const messagesSchema = z.array(messageSchema)

/**
 * Model id -> transcript. A record rather than an array keyed by a `model`
 * field: lookup on model switch is the only read this shape ever serves.
 */
export const conversationsSchema = z.record(
  z.string(),
  z.object({
    messages: messagesSchema,
    updatedAt: z.number(),
  })
)
