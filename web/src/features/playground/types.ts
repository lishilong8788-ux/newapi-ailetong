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
import type { PricingModel } from '@/features/pricing/types'

import type { PlaygroundModality } from './lib/capability'

// Message types
export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageStatus = 'loading' | 'streaming' | 'complete' | 'error'

export type PlaygroundMessageLayoutMode = 'alternating' | 'left'

export interface MessageVersion {
  id: string
  content: string
}

export interface Message {
  key: string
  from: MessageRole
  versions: MessageVersion[]
  /** Image attachments (data URLs) sent alongside the message text. */
  images?: string[]
  createdAt?: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  /**
   * Which channel actually served this reply, read from the response headers.
   *
   * The whole point of pinning a channel is being able to check it was honoured,
   * so `pinned` is recorded separately from "a channel is known": automatic
   * routing also reports a channel, and a pin that silently fell through to
   * another line must not read the same as one that held.
   *
   * Absent on messages predating this field and on any reply whose headers were
   * unreadable, which the debug panel states rather than guessing.
   */
  channel?: {
    id: number
    /** Short line code (`hs4`); absent falls back to `#id` for display. */
    code?: string
    pinned: boolean
  }
  /**
   * Time to first token, measured client-side from request start to the first
   * content chunk.
   *
   * Only exists for streaming requests — a non-streaming response has no
   * observable first token — and that absence is reported as such instead of as
   * a missing measurement.
   */
  ttftMs?: number
  /**
   * Token counts as the gateway reported them, never as the client counted them.
   *
   * Present on both transports: the relay defaults `includeUsage` to true for
   * streams (`relay/compatible_handler.go`) and synthesises a final usage chunk
   * before `[DONE]`, so a stream carries this as well as a plain response.
   * Absent means the upstream reported none — which is why the debug panel omits
   * the row rather than printing zeros.
   *
   * Field names stay snake_case, matching the `usage` object they are parsed
   * from verbatim: renaming three fields on the way in buys nothing and puts a
   * translation step between the wire and the panel that reads them.
   *
   * Each count is optional on its own — an upstream may report totals without
   * the split — so a partial report loses only the lines it lacks.
   */
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  /**
   * The gateway's own request id, from the `X-Oneapi-Request-Id` response header.
   *
   * Worth surfacing only because it resolves: `middleware.RequestId()` is
   * registered globally and the same id is written to the consume log, so it
   * joins a reply on screen to its billing row. The upstream's `chatcmpl-…` id
   * does not, and a client-generated uuid would be worse than nothing.
   */
  requestId?: string
  sources?: { href: string; title: string }[]
  reasoning?: {
    content: string
    duration: number
    startedAt?: number
    completedAt?: number
    durationMs?: number
  }
  /**
   * Generated videos on an assistant message, as playable URLs.
   *
   * Separate from `results` rather than reusing it: a video needs a `<video>`
   * element with controls, and an image grid layout applied to one would render a
   * thumbnail nobody can play.
   */
  videos?: string[]
  /**
   * Marks a message whose reply comes from an async task rather than a response.
   *
   * Set at submit time, before any progress is known, so the waiting state can
   * say "generating video" from the first frame. Inferring it from `taskProgress`
   * instead would spend the first poll interval showing the chat wording and then
   * visibly change its mind.
   */
  isTaskPending?: boolean
  /**
   * Task progress, 0-100, while an async generation is running.
   *
   * Only meaningful on a pending message, and cleared when it settles. Undefined
   * means the platform reports no progress — distinct from 0, which would claim
   * the work has not started.
   */
  taskProgress?: number
  /**
   * Generated images on an assistant message, as displayable URLs.
   *
   * Distinct from `images`, which is what the *user* attached. The upstream may
   * answer with either a hosted `url` or inline `b64_json`; both are normalised
   * to something an `<img src>` accepts before landing here.
   */
  results?: string[]
  isReasoningStreaming?: boolean
  isReasoningComplete?: boolean
  isContentComplete?: boolean
  status?: MessageStatus
  errorCode?: string | null
}

// API payload types
export interface ChatCompletionMessage {
  role: MessageRole
  content: string | ContentPart[]
}

export interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
  }
}

export interface ChatCompletionRequest {
  model: string
  group?: string
  messages: ChatCompletionMessage[]
  stream: boolean
}

/**
 * Mirrors the subset of `relaykit/dto.ImageRequest` this surface sends. `n`,
 * `size` and `quality` are omitted unless a chip sets them, so the upstream
 * default applies — same reasoning as `PlaygroundConfig`.
 */
export interface ImageGenerationRequest {
  model: string
  group?: string
  prompt: string
  n?: number
  size?: string
  quality?: string
}

export interface ImageGenerationResponse {
  created?: number
  data?: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
}

export interface VideoGenerationRequest {
  model: string
  group?: string
  prompt: string
  /** Seconds. Billed per second, so this drives the cost directly. */
  duration?: number
  size?: string
}

/**
 * The submit response. Only an id — the video does not exist yet.
 *
 * Shape varies by upstream platform, so every field is optional and the caller
 * takes the first id it recognises.
 */
export interface VideoSubmitResponse {
  task_id?: string
  id?: string
  data?: { task_id?: string; id?: string }
}

/** Terminal states end polling; the rest mean "keep waiting". */
export type VideoTaskStatus =
  | 'NOT_START'
  | 'SUBMITTED'
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'SUCCESS'
  | 'FAILURE'
  | 'UNKNOWN'

/**
 * The poll response, normalised by the backend into `TaskDto` regardless of
 * which platform served it (`relay/relay_task.go`, `TaskModel2Dto`).
 */
export interface VideoTaskResponse {
  code?: string
  data?: {
    task_id?: string
    status?: VideoTaskStatus
    /** 0-100. Some platforms send a bare number, others a "50%" string. */
    progress?: number | string
    result_url?: string
    fail_reason?: string
  }
}

export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: MessageRole
      content?: string
      reasoning_content?: string
    }
    finish_reason: string | null
  }>
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: MessageRole
      content: string
      reasoning_content?: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * What the composer sends, and nothing more.
 *
 * A sampling block (`temperature`, `top_p`, `max_tokens`, `seed`, each behind
 * its own enable flag) used to live here behind an `Advanced settings` panel.
 * All four defaulted to off, so the panel's normal state was "changes nothing",
 * and this surface exists to check that a model answers at all — the upstream
 * default is the right sampling for that. Sending no field is also the only
 * safe default across hundreds of heterogeneous models: Claude 4+ rejects
 * `temperature` and `top_p` together, and `max_tokens` ceilings differ per
 * model. Per-modality controls that change *what* is produced (aspect ratio,
 * duration, count) are a different thing and stay in the capability registry.
 */
export interface PlaygroundConfig {
  model: string
  group: string
  stream: boolean
  /**
   * Pinned upstream channel, or `undefined` for automatic routing.
   *
   * Automatic routing is the default and the only thing a non-admin can use —
   * pinning is gated on `model.IsAdmin` server-side (`middleware/auth.go`), so a
   * stored value from an account that later loses admin is simply ignored rather
   * than turning every request into a 403.
   *
   * Scoped to one model: a channel serves specific models, so the id carried
   * across a model switch would name a line that cannot answer. `usePlaygroundOptions`
   * clears it for that reason.
   */
  channelId?: number
}

/**
 * One model's transcript. Keyed by model id in storage and in state, so
 * switching models swaps the canvas instead of appending to whatever was
 * already there — a reply from `gpt-4o` is not context for `claude-sonnet-4`.
 */
export interface PlaygroundConversation {
  messages: Message[]
  /** Last write, used to evict the least recently used transcripts. */
  updatedAt: number
}

export type PlaygroundConversations = Record<string, PlaygroundConversation>

// Model and group options
export interface ModelOption {
  label: string
  value: string
  /**
   * Catalog metadata joined in from `/api/pricing`. All optional: the
   * permission source (`/api/user/models`) is authoritative for which models
   * exist, and a model with no catalog entry still has to render.
   */
  modality?: PlaygroundModality
  description?: string
  icon?: string
  tags?: string[]
  vendorId?: number
  vendorName?: string
  vendorIcon?: string
  /** Endpoint types as reported by the backend, kept for debugging. */
  endpointTypes?: string[]
  /**
   * The raw `/api/pricing` row, kept whole rather than copied field by field:
   * quoting a price needs `quota_type`, `model_ratio`, `completion_ratio`,
   * `model_price` and the per-type ratios together, and `formatPrice` already
   * takes the entry as its first argument.
   */
  pricing?: PricingModel
}

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}
