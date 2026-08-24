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
import type { PlaygroundModality } from './types'

/**
 * Endpoint types that mean "this model holds a conversation". They differ in
 * wire format, not in what the user is trying to do, so they collapse to one
 * modality.
 *
 * Mirrors `relaykit/types/endpoint_type.go`.
 */
const CHAT_ENDPOINTS = new Set([
  'openai',
  'openai-response',
  'openai-response-compact',
  'openai-alpha-search',
  'anthropic',
  'gemini',
])

const IMAGE_ENDPOINTS = new Set(['image-generation'])

const VIDEO_ENDPOINTS = new Set(['openai-video'])

/**
 * Endpoint types that are real relay targets but have no place in the
 * playground: there is nothing for a person to look at.
 */
const NON_INTERACTIVE_ENDPOINTS = new Set(['embeddings', 'jina-rerank'])

/**
 * Tag that marks a speech model.
 *
 * The backend has no audio endpoint type — `/v1/audio/speech` relays through
 * `RelayFormatOpenAIAudio` without one — so audio is classified by tag until
 * (and unless) a real endpoint type is added. Tags are plain config, so this
 * costs no backend change.
 */
const AUDIO_TAG = 'audio'

function parseTags(tags?: string): string[] {
  if (!tags) return []
  return tags
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Resolves the task modality for a model.
 *
 * Returns `null` when the model has no interactive surface, which is the signal
 * to leave it out of the model library entirely.
 *
 * Audio is checked first because a speech model is still served over an
 * OpenAI-shaped endpoint, so the endpoint alone would misread it as chat.
 */
export function deriveModality(
  endpointTypes?: string[],
  tags?: string
): PlaygroundModality | null {
  if (parseTags(tags).includes(AUDIO_TAG)) return 'audio'

  const endpoints = endpointTypes ?? []
  if (endpoints.some((type) => IMAGE_ENDPOINTS.has(type))) return 'image'
  if (endpoints.some((type) => VIDEO_ENDPOINTS.has(type))) return 'video'
  if (endpoints.some((type) => CHAT_ENDPOINTS.has(type))) return 'chat'

  // Known-but-not-interactive resolves to null rather than falling through, so
  // an embeddings model never gets a chat canvas by accident.
  if (endpoints.some((type) => NON_INTERACTIVE_ENDPOINTS.has(type))) return null

  // Unknown or absent endpoint types: treat as chat. Most deployments predate
  // endpoint metadata, and hiding those models would empty the library.
  return endpoints.length === 0 ? 'chat' : null
}

/** True when a model should appear in the playground model library. */
export function isPlaygroundModel(
  endpointTypes?: string[],
  tags?: string
): boolean {
  return deriveModality(endpointTypes, tags) !== null
}
