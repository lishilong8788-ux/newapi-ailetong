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

import { API_ENDPOINTS } from './constants'
import { buildModelCatalog } from './lib/catalog/model-catalog'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ModelOption,
  GroupOption,
} from './types'

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
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
