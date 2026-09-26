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
// ============================================================================
// Server payloads
// ============================================================================

export interface CopilotStatus {
  enabled: boolean
  /** Whether a usable model + channel pair is configured. False disables chat. */
  configured: boolean
  model: string
  channel_id: number
  max_rounds: number
  /**
   * Whether this viewer may change the selection. `copilot_setting.*` is a global
   * option, so the write is root-gated like every other one — an admin below that
   * uses the copilot but reads the picker rather than operating it.
   */
  can_configure: boolean
}

/** One channel that can serve a model, as offered by the picker. */
export interface CopilotChannelChoice {
  channel_id: number
  name: string
  /** The channel's public line code; absent when the operator configured none. */
  code?: string
  type: number
}

/**
 * One model the copilot may be pointed at, with the channels behind it.
 *
 * Derived server-side from abilities, so every pair here is one the router would
 * actually accept — a model whose only channel is disabled is not offered.
 */
export interface CopilotModelOption {
  model: string
  channels: CopilotChannelChoice[]
}

export interface CopilotModelsData {
  /** The group the copilot routes in; named so the list has a stated scope. */
  group: string
  models: CopilotModelOption[]
}

/** Partial update: an omitted field is left as configured. */
export interface CopilotConfigUpdate {
  enabled?: boolean
  model?: string
  channel_id?: number
}

export interface CopilotSession {
  id: number
  title: string
  created_time: number
  updated_time: number
}

/**
 * One persisted message, as stored per turn rather than per rendered block.
 *
 * `tool_calls` carries the assistant's requested calls and `tool_call_id` links a
 * `role: 'tool'` row back to the call it answers — the OpenAI message shape. A
 * replayed history therefore has to be folded back into turns (see
 * `lib/history.ts`); it is not one message per bubble.
 */
export interface CopilotMessage {
  role: 'assistant' | 'system' | 'tool' | 'user'
  content: string
  /** Server-relative image paths; fetch them through `getCopilotImageUrl`. */
  images?: string[] | null
  tool_calls?: CopilotToolCall[] | null
  tool_call_id?: string
  prompt_tokens?: number
  completion_tokens?: number
  created_time: number
}

export interface CopilotToolCall {
  id: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}
export interface CopilotSessionDetail {
  session: CopilotSession
  messages: CopilotMessage[]
}

export interface CopilotEnvelope<T> {
  success: boolean
  message?: string
  data?: T
}

export interface CopilotSessionPage {
  items: CopilotSession[]
  total: number
  page?: number
  page_size?: number
}

// ============================================================================
// Stream frames (pinned contract — names come straight off the wire)
// ============================================================================

export type CopilotFrame =
  | { type: 'done' }
  | { type: 'error'; text: string }
  | { type: 'text'; text: string }
  | {
      /**
       * The copilot wants to write and the turn stopped to ask. Terminal, not a
       * pause: SSE is one-way, so the stream ends here and approving means
       * replaying the turn with `approved_tool` set.
       */
      type: 'confirm_required'
      tool_name: string
      tool_args?: unknown
      tool_call_id: string
    }
  | {
      type: 'tool_end'
      tool_call_id: string
      duration_ms: number
      ok: boolean
      error_text?: string
    }
  | {
      type: 'tool_start'
      tool_name: string
      tool_args?: unknown
      tool_call_id: string
    }
  | { type: 'usage'; prompt_tokens: number; completion_tokens: number }

// ============================================================================
// Rendered turn model
// ============================================================================

export type CopilotToolStatus = 'error' | 'running' | 'success'

export interface CopilotTextBlock {
  kind: 'text'
  id: string
  text: string
}

export interface CopilotToolBlock {
  kind: 'tool'
  id: string
  toolCallId: string
  toolName: string
  /** Parsed when the frame carried JSON, else the raw string it sent. */
  args: unknown
  status: CopilotToolStatus
  durationMs?: number
  errorText?: string
}

export type CopilotBlock = CopilotTextBlock | CopilotToolBlock

export interface CopilotUsage {
  promptTokens: number
  completionTokens: number
}

/**
 * `awaiting_confirmation` is its own outcome rather than a flavour of `done`:
 * the turn stopped without finishing its work, and the difference is what the
 * operator has to do next. Collapsing it into `done` would draw a completed
 * turn over a write that never happened.
 *
 * `declined` is the same turn after the operator refused. Also not `done`: the
 * transcript has to keep saying that a write was proposed and turned down,
 * otherwise the turn reads as having simply ended and the next reader cannot
 * tell that the copilot asked for something.
 */
export type CopilotTurnStatus =
  | 'awaiting_confirmation'
  | 'declined'
  | 'done'
  | 'error'
  | 'streaming'

/**
 * Which tools the copilot may use this turn. Values match the backend's
 * `ModeAsk` / `ModeAct`; see `COPILOT_MODE_ASK` / `COPILOT_MODE_ACT`.
 */
export type CopilotMode = 'act' | 'ask'

/** A write the copilot proposed, held until the operator approves or cancels. */
export interface CopilotPendingWrite {
  toolName: string
  /** Parsed when the frame carried JSON, else the raw string, as tool blocks do. */
  args: unknown
  toolCallId: string
}

export interface CopilotAssistantTurn {
  role: 'assistant'
  id: string
  blocks: CopilotBlock[]
  status: CopilotTurnStatus
  errorText?: string
  usage?: CopilotUsage
  /**
   * The write the copilot asked for. Kept through `declined` as well as
   * `awaiting_confirmation` so a refused turn can still name what was refused.
   */
  pendingWrite?: CopilotPendingWrite
}

export interface CopilotUserTurn {
  role: 'user'
  id: string
  text: string
  /**
   * Either local data URLs (the turn the operator just sent) or server-relative
   * paths (a turn read back from history). Both render the same way; the
   * difference only matters to whoever resolves a path into something an `<img>`
   * can load.
   */
  images?: string[]
}

export type CopilotTurn = CopilotAssistantTurn | CopilotUserTurn
