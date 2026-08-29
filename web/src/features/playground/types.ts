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
  sources?: { href: string; title: string }[]
  reasoning?: {
    content: string
    duration: number
    startedAt?: number
    completedAt?: number
    durationMs?: number
  }
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
