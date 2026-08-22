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
import type { ModelCapability } from '../types'

// ----------------------------------------------------------------------------
// Model catalog fields
// ----------------------------------------------------------------------------
//
// Vocabulary and formatters for the descriptive (non-price) model fields shown
// in the details view: context window, max output, modalities, capabilities,
// knowledge cutoff, release date.
//
// None of these are returned by `/api/pricing` yet — `model.Pricing` carries
// only description / icon / tags / vendor. The details view renders them as
// placeholders on purpose, so the layout is already in its final shape when the
// backend starts filling them in. Formatters therefore all have to survive
// `undefined` without throwing.

export const CAPABILITY_LABEL_KEYS: Record<ModelCapability, string> = {
  function_calling: 'Function calling',
  streaming: 'Streaming',
  vision: 'Vision',
  json_mode: 'JSON mode',
  structured_output: 'Structured output',
  reasoning: 'Reasoning',
  tools: 'Tools',
  system_prompt: 'System prompt',
  web_search: 'Web search',
  code_interpreter: 'Code interpreter',
  caching: 'Prompt caching',
  embeddings: 'Embeddings',
}

export const MODALITY_LABEL_KEYS: Record<string, string> = {
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  file: 'File',
}

const TOKEN_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
})

/** `200000` -> `200K`. Empty string when absent or non-positive. */
export function formatCatalogTokenCount(tokens?: number): string {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens >= 1_000_000) return `${TOKEN_FORMAT.format(tokens / 1_000_000)}M`
  if (tokens >= 1_000) return `${TOKEN_FORMAT.format(tokens / 1_000)}K`
  return TOKEN_FORMAT.format(tokens)
}

/** `2025-04` -> `Apr 2025`, localized. Unparseable input is passed through. */
export function formatCatalogYearMonth(value?: string): string {
  if (!value) return ''
  const [yearStr, monthStr] = value.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return value
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
  })
}

export function normalizeCatalogItems(items?: readonly string[]): string[] {
  if (!items) return []
  return items.filter((item) => item.trim().length > 0)
}
