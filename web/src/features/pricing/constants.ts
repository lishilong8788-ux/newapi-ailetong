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
import { type TFunction } from 'i18next'

import type { StatusVariant } from '@/components/status-badge'

import type { TokenUnit } from './types'

// ----------------------------------------------------------------------------
// Pricing Constants
// ----------------------------------------------------------------------------

/** Sort options for pricing models */
export const SORT_OPTIONS = {
  NAME: 'name',
  PRICE_LOW: 'price-low',
  PRICE_HIGH: 'price-high',
} as const

export type SortOption = (typeof SORT_OPTIONS)[keyof typeof SORT_OPTIONS]

export function getSortLabels(t: TFunction): Record<SortOption, string> {
  return {
    [SORT_OPTIONS.NAME]: t('Name'),
    [SORT_OPTIONS.PRICE_LOW]: t('Price: Low to High'),
    [SORT_OPTIONS.PRICE_HIGH]: t('Price: High to Low'),
  }
}

/** Filter values */
export const FILTER_ALL = 'all'

/** Quota type options */
export const QUOTA_TYPES = {
  ALL: 'all',
  TOKEN: 'token',
  REQUEST: 'request',
} as const

export type QuotaTypeOption = (typeof QUOTA_TYPES)[keyof typeof QUOTA_TYPES]

/** Quota type labels */
export function getQuotaTypeLabels(
  t: TFunction
): Record<QuotaTypeOption, string> {
  return {
    [QUOTA_TYPES.ALL]: t('All Models'),
    [QUOTA_TYPES.TOKEN]: t('Token-based'),
    [QUOTA_TYPES.REQUEST]: t('Per Request'),
  }
}

/** Endpoint type options */
export const ENDPOINT_TYPES = {
  ALL: 'all',
  OPENAI: 'openai',
  OPENAI_RESPONSE: 'openai-response',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  JINA_RERANK: 'jina-rerank',
  IMAGE_GENERATION: 'image-generation',
  EMBEDDINGS: 'embeddings',
  OPENAI_VIDEO: 'openai-video',
} as const

export type EndpointTypeOption =
  (typeof ENDPOINT_TYPES)[keyof typeof ENDPOINT_TYPES]

/** Endpoint type labels */
export function getEndpointTypeLabels(
  t: TFunction
): Record<EndpointTypeOption, string> {
  return {
    [ENDPOINT_TYPES.ALL]: t('All Types'),
    [ENDPOINT_TYPES.OPENAI]: 'Chat',
    [ENDPOINT_TYPES.OPENAI_RESPONSE]: 'Response',
    [ENDPOINT_TYPES.ANTHROPIC]: 'Anthropic',
    [ENDPOINT_TYPES.GEMINI]: 'Gemini',
    [ENDPOINT_TYPES.JINA_RERANK]: 'Rerank',
    [ENDPOINT_TYPES.IMAGE_GENERATION]: t('Image'),
    [ENDPOINT_TYPES.EMBEDDINGS]: t('Embeddings'),
    [ENDPOINT_TYPES.OPENAI_VIDEO]: t('Video'),
  }
}

/** Filter section keys */
export const FILTER_SECTIONS = {
  PRICING_TYPE: 'pricingType',
  ENDPOINT_TYPE: 'endpointType',
  VENDOR: 'vendor',
  GROUP: 'group',
  TAG: 'tag',
} as const

/** Maximum number of tags to display in model row */
export const MAX_TAGS_DISPLAY = 5

/**
 * Colors for well-known operational tags (from the `models.tags` column).
 *
 * Keys are matched case-insensitively against the parsed tag. Tags absent from
 * this map fall back to `DEFAULT_TAG_VARIANT`, so operators can add arbitrary
 * tags without a code change — they just render in the neutral style.
 */
export const TAG_VARIANTS: Record<string, StatusVariant> = {
  // Promotion / attention
  热门: 'red',
  hot: 'red',
  popular: 'red',
  推荐: 'orange',
  recommended: 'orange',
  新: 'success',
  新品: 'success',
  new: 'success',
  限时: 'pink',
  // Capability
  推理: 'violet',
  reasoning: 'violet',
  视觉: 'cyan',
  vision: 'cyan',
  多模态: 'cyan',
  multimodal: 'cyan',
  长文本: 'blue',
  'long-context': 'blue',
  联网: 'teal',
  // Lifecycle
  免费: 'success',
  free: 'success',
  测试: 'warning',
  beta: 'warning',
  实验性: 'warning',
  即将下线: 'danger',
  deprecated: 'danger',
}

/** Style used for tags with no explicit entry in `TAG_VARIANTS`. */
export const DEFAULT_TAG_VARIANT: StatusVariant = 'neutral'

/**
 * Tags that describe a commercial offer rather than a capability. These are the
 * ones a buyer scans for, so the model card renders them with a travelling
 * highlight and floats them ahead of the capability tags.
 *
 * Capability tags (`推理`, `视觉`, `长文本`) are deliberately excluded: they are
 * useful, but animating them would spend the card's one attention-grabbing
 * device on something nobody is hunting for.
 */
export const PROMO_TAGS = new Set([
  '热门',
  'hot',
  'popular',
  '推荐',
  'recommended',
  '限时',
  '新',
  '新品',
  'new',
  '免费',
  'free',
])

/** Maximum operational tags shown on a model card before collapsing to "+N". */
export const MAX_CARD_TAGS = 3

/** Maximum number of filter items to display before showing "More..." */
export const MAX_FILTER_ITEMS = 5

/**
 * Column template for the pricing shell: filter rail + fluid content.
 *
 * The rail widens with the viewport rather than sitting at one narrow fixed
 * width, because vendor chips carry an icon, a name and a count and wrapped one
 * per row when the rail was 240px. Deliberately has no `max-w-*` cap — the page
 * runs edge to edge and only its horizontal padding holds content off the
 * viewport edge.
 */
export const PRICING_SHELL_COLUMNS_CLASS =
  'xl:grid-cols-[272px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]'

/**
 * Column ladder for the model card grid. The fifth column is keyed to the
 * viewport rather than a named breakpoint: on a 1920px display four columns give
 * each card ~370px, well past the width the card's type scale is tuned for.
 */
export const PRICING_CARD_GRID_COLUMNS_CLASS =
  'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5'

/**
 * Type and icon scale for the filter rail.
 *
 * One step above the app's default chip metrics on purpose. The rail is the
 * page's primary navigation, so at `text-xs`/14px icons it read as fine print
 * next to the card grid it drives — vendor marks in particular were too small
 * to identify at a glance, which is the whole point of showing them.
 */
export const PRICING_FILTER_SCALE = {
  /** Panel heading ("Filter"). */
  panelTitle: 'text-base',
  /** Per-section headings ("Groups", "Model Tags", ...). */
  sectionTitle: 'text-[15px]',
  /** Chip label. */
  chipLabel: 'text-[13px]',
  /** Count/ratio badge inside a chip. Stays below the label. */
  chipBadge: 'text-[12px]',
  /** Vendor mark rendered inside a chip, in px. */
  chipIconSize: 16,
} as const

/** Excluded groups */
export const EXCLUDED_GROUPS = ['', 'auto']

/** Quota type values */
export const QUOTA_TYPE_VALUES = {
  TOKEN: 0,
  REQUEST: 1,
} as const

/** Token unit divisors */
export const TOKEN_UNIT_DIVISORS = {
  M: 1,
  K: 1000,
} as const

/** Default token unit for pricing display */
export const DEFAULT_TOKEN_UNIT: TokenUnit = 'M'

/** View mode options */
export const VIEW_MODES = {
  CARD: 'card',
  TABLE: 'table',
} as const

export type ViewMode = (typeof VIEW_MODES)[keyof typeof VIEW_MODES]

/** Default page size for pricing table */
export const DEFAULT_PRICING_PAGE_SIZE = 20
