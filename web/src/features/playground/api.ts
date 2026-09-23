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
import type { PricingModel, PricingVendor } from '@/features/pricing/types'
import { api } from '@/lib/api'

import { API_ENDPOINTS, CHANNEL_HEADERS, REQUEST_ID_HEADER } from './constants'
import { buildModelCatalog } from './lib/catalog/model-catalog'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  Message,
  ModelOption,
  GroupOption,
  VideoGenerationRequest,
  VideoSubmitResponse,
  VideoTaskResponse,
} from './types'

/** Response headers as the two transports expose them, keyed case-insensitively. */
export type ResponseHeaderRecord = Record<string, string | undefined>

/**
 * A non-streaming reply plus the headers that came with it.
 *
 * The body alone is no longer enough: which channel served the request is
 * reported out of band, and it has to reach the message the same way the content
 * does or the two disagree about the same reply.
 */
export type ChatCompletionResult = {
  data: ChatCompletionResponse
  headers: ResponseHeaderRecord
}

/**
 * Which channel served a reply, read from the response headers.
 *
 * Shared by both transports because they only differ in how the headers arrive
 * (axios exposes them directly, `sse.js` on its header event) — what the trio
 * means is one rule, and two copies of it would eventually disagree.
 *
 * Returns `undefined` when the id is missing or unparseable, which is a real
 * state rather than an error: the backend half of this is still being built, and
 * a reply whose channel is unknown says so instead of naming channel 0.
 */
export function parseChannelEcho(
  headers: ResponseHeaderRecord
): Message['channel'] {
  const lowercased: ResponseHeaderRecord = {}
  for (const [name, value] of Object.entries(headers)) {
    lowercased[name.toLowerCase()] = value
  }

  const id = Number(lowercased[CHANNEL_HEADERS.RESPONSE_CHANNEL_ID])
  if (!Number.isInteger(id) || id <= 0) {
    return undefined
  }

  const code = lowercased[CHANNEL_HEADERS.RESPONSE_CHANNEL_CODE]?.trim()

  return {
    id,
    // A channel with no `model_mapping` suffix has no code, so the display falls
    // back to `#id` rather than inventing a label.
    ...(code ? { code } : {}),
    pinned: lowercased[CHANNEL_HEADERS.RESPONSE_CHANNEL_PINNED] === '1',
  }
}

/**
 * The gateway's request id, read from the same headers as the channel echo.
 *
 * Set by `middleware.RequestId()` on every route, and the same value is written
 * to the consume log, so it joins a reply on screen to its billing row. That is
 * the whole reason it is worth showing — the upstream's `chatcmpl-…` id resolves
 * to nothing locally, and a client-generated one would resolve to nothing at all.
 */
export function parseRequestId(
  headers: ResponseHeaderRecord
): string | undefined {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== REQUEST_ID_HEADER) continue
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
  }

  return undefined
}

/**
 * Send chat completion request (non-streaming)
 *
 * `requestHeaders` carries the channel pin when one is set. Automatic routing
 * sends no such header at all — an empty value would be a pin on nothing.
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal,
  requestHeaders?: Record<string, string>
): Promise<ChatCompletionResult> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
    ...(requestHeaders ? { headers: requestHeaders } : {}),
  } as Record<string, unknown>)

  return {
    data: res.data,
    headers: res.headers as ResponseHeaderRecord,
  }
}

/**
 * Generate images. Always non-streaming: the upstream answers once with the
 * whole batch, so there is nothing to stream.
 */
export async function sendImageGeneration(
  payload: ImageGenerationRequest,
  signal?: AbortSignal
): Promise<ImageGenerationResponse> {
  const res = await api.post(API_ENDPOINTS.IMAGE_GENERATIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Submit a video generation task. Returns an id, not a video.
 *
 * The task runs on the backend and outlives this request, which is why nothing
 * here waits: the caller polls `fetchVideoTask` until a terminal status.
 */
export async function submitVideoTask(
  payload: VideoGenerationRequest,
  signal?: AbortSignal
): Promise<VideoSubmitResponse> {
  const res = await api.post(API_ENDPOINTS.VIDEO_GENERATIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Read one task's current state.
 *
 * Ownership is enforced server-side from the session user, so a task id from
 * another account resolves to `task_not_exist` rather than someone else's video.
 */
export async function fetchVideoTask(
  taskId: string,
  signal?: AbortSignal
): Promise<VideoTaskResponse> {
  const res = await api.get(
    `${API_ENDPOINTS.VIDEO_GENERATIONS}/${encodeURIComponent(taskId)}`,
    {
      signal,
      skipErrorHandler: true,
    } as Record<string, unknown>
  )
  return res.data
}

/**
 * Get the models the user can call in a group, enriched with catalog metadata.
 *
 * Two requests, two roles: `/api/user/models` decides *which* models exist for
 * this user, `/api/pricing` supplies icon/description/vendor/modality. A failing
 * catalog request degrades to bare names instead of emptying the library.
 */
export async function getUserModels(group: string): Promise<ModelOption[]> {
  const [modelsRes, pricing] = await Promise.all([
    api.get(API_ENDPOINTS.USER_MODELS, { params: { group } }),
    getModelCatalogMetadata(),
  ])

  const { data } = modelsRes
  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return buildModelCatalog(
    data.data as string[],
    pricing.models,
    pricing.vendors
  )
}

/**
 * Catalog metadata is decorative, so a failure here must not take the model
 * library down with it.
 */
async function getModelCatalogMetadata(): Promise<{
  models: PricingModel[]
  vendors: PricingVendor[]
}> {
  try {
    const res = await api.get(API_ENDPOINTS.PRICING)
    const { data } = res
    return {
      models: Array.isArray(data?.data) ? data.data : [],
      vendors: Array.isArray(data?.vendors) ? data.vendors : [],
    }
  } catch {
    return { models: [], vendors: [] }
  }
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>

  // label is for button display (name only); desc is for dropdown content
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}
