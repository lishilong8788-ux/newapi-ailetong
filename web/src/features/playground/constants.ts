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
import type { PlaygroundConfig } from './types'

// Message constants
export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
} as const

export const MESSAGE_STATUS = {
  LOADING: 'loading',
  STREAMING: 'streaming',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const

// API endpoints
export const API_ENDPOINTS = {
  CHAT_COMPLETIONS: '/pg/chat/completions',
  IMAGE_GENERATIONS: '/pg/images/generations',
  /**
   * Video submits a task and returns an id; the result is polled from
   * `${VIDEO_GENERATIONS}/${taskId}`. Unlike chat and image, the response to the
   * POST is never the result.
   */
  VIDEO_GENERATIONS: '/pg/video/generations',
  USER_MODELS: '/api/user/models',
  USER_GROUPS: '/api/user/self/groups',
  /** Catalog metadata (icon, description, vendor, endpoint types). */
  PRICING: '/api/pricing',
  /** Per-channel price tiers, stability and first-token time for one model. */
  PRICING_CHANNELS: '/api/pricing/channels',
} as const

/**
 * Channel pinning and echo travel in headers, never in the body.
 *
 * The request body is OpenAI-shaped and forwarded to the upstream provider
 * verbatim, so an extra field there would be sent to a vendor that never asked
 * for it. Headers are ours to add and are already how the relay reports
 * out-of-band facts (`X-New-Api-Other-Ratios` in `relay/relay_task.go`).
 *
 * The response trio is readable from both transports: axios exposes them
 * directly, and `sse.js` surfaces them on the `readystatechange` event once
 * `readyState` reaches `HEADERS_RECEIVED` (lowercased keys, array values).
 */
/**
 * The gateway's request-id response header, lowercased for lookup.
 *
 * Spelled `Oneapi` rather than `New-Api`: `middleware.RequestId()` predates the
 * rename and the wire name is what it is. Worth reading because the same id goes
 * into the consume log, so it ties a reply to its billing row.
 */
export const REQUEST_ID_HEADER = 'x-oneapi-request-id' as const

export const CHANNEL_HEADERS = {
  /** Request: pin this channel. Omitted entirely for automatic routing. */
  REQUEST_CHANNEL_ID: 'X-New-Api-Channel-Id',
  /** Response: the channel that actually served the request. */
  RESPONSE_CHANNEL_ID: 'x-new-api-channel-id',
  /** Response: its short line code, absent when the mapping carries no suffix. */
  RESPONSE_CHANNEL_CODE: 'x-new-api-channel-code',
  /** Response: `1` when the pin was honoured, `0` when the router chose. */
  RESPONSE_CHANNEL_PINNED: 'x-new-api-channel-pinned',
} as const

// Default group — uses 'default' as the safe fallback; auto-group is
// only selected when the backend confirms it is available for the user.
export const DEFAULT_GROUP = 'default' as const

// Default configuration
export const DEFAULT_CONFIG: PlaygroundConfig = {
  model: 'gpt-4o',
  group: DEFAULT_GROUP,
  stream: true,
}

// Storage keys
export const STORAGE_KEYS = {
  CONFIG: 'playground_config',
  /**
   * Per-model transcripts, replacing the single flat `playground_messages`
   * array. A separate key rather than a version bump on the old one: the shapes
   * are incompatible (array vs. keyed record), and `loadConversations` migrates
   * the old array into the active model's slot on first read, so nothing is lost.
   */
  CONVERSATIONS: 'playground_conversations',
  /** Read once by the migration above, then removed. */
  LEGACY_MESSAGES: 'playground_messages',
} as const

// Error messages
export const ERROR_MESSAGES = {
  API_REQUEST_ERROR: 'Request error occurred',
  NETWORK_ERROR: 'Network connection failed or server not responding',
  PARSE_ERROR: 'Error parsing response data',
  STREAM_START_ERROR: 'Error establishing connection',
  CONNECTION_CLOSED: 'Connection closed',
  INTERRUPTED: 'Generation was interrupted',
} as const

// Message action button styles
export const MESSAGE_ACTION_BUTTON_STYLES = {
  BASE: 'size-7 text-muted-foreground hover:text-foreground',
  DELETE: 'size-7 text-muted-foreground hover:text-destructive',
  ICON: 'size-4',
} as const

// Message action labels
export const MESSAGE_ACTION_LABELS = {
  COPY: 'Copy',
  COPIED: 'Copied!',
  REGENERATE: 'Regenerate',
  SHOW_PREVIEW: 'Show preview',
  SHOW_SOURCE: 'Show source',
  EDIT: 'Edit',
  DELETE: 'Delete',
  NO_CONTENT: 'No content to copy',
  WAIT_GENERATION: 'Please wait for the current generation to complete',
} as const
