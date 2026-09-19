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
import {
  resolveTag,
  resolveTagList,
  type ResolveTagOptions,
} from '@/lib/model-tags'

import {
  SORT_OPTIONS,
  FILTER_ALL,
  QUOTA_TYPES,
  QUOTA_TYPE_VALUES,
  ENDPOINT_TYPES,
} from '../constants'
import type { PricingModel } from '../types'

// ----------------------------------------------------------------------------
// Filter Utilities
// ----------------------------------------------------------------------------

/**
 * Filter models by search query
 */
export function filterBySearch(
  models: PricingModel[],
  query: string
): PricingModel[] {
  if (!query) return models

  const lowerQuery = query.toLowerCase()
  return models.filter(
    (m) =>
      m.model_name?.toLowerCase().includes(lowerQuery) ||
      m.description?.toLowerCase().includes(lowerQuery) ||
      m.tags?.toLowerCase().includes(lowerQuery) ||
      m.vendor_name?.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Filter models by vendor
 */
export function filterByVendor(
  models: PricingModel[],
  vendor: string
): PricingModel[] {
  if (vendor === FILTER_ALL) return models
  return models.filter((m) => m.vendor_name === vendor)
}

/**
 * Filter models by group
 */
export function filterByGroup(
  models: PricingModel[],
  group: string
): PricingModel[] {
  if (group === FILTER_ALL) return models
  return models.filter((m) => m.enable_groups?.includes(group))
}

/**
 * Filter models by quota type
 */
export function filterByQuotaType(
  models: PricingModel[],
  quotaType: string
): PricingModel[] {
  if (quotaType === QUOTA_TYPES.ALL) return models
  const targetType =
    quotaType === QUOTA_TYPES.TOKEN
      ? QUOTA_TYPE_VALUES.TOKEN
      : QUOTA_TYPE_VALUES.REQUEST
  return models.filter((m) => m.quota_type === targetType)
}

/**
 * Filter models by endpoint type
 */
export function filterByEndpointType(
  models: PricingModel[],
  endpointType: string
): PricingModel[] {
  if (endpointType === ENDPOINT_TYPES.ALL) return models
  return models.filter((m) =>
    m.supported_endpoint_types?.includes(endpointType)
  )
}

/**
 * Get model price for sorting
 */
function getModelPrice(model: PricingModel): number {
  return model.quota_type === 0 ? model.model_ratio : model.model_price || 0
}

/**
 * Sort models by specified option
 */
export function sortModels(
  models: PricingModel[],
  sortBy: string
): PricingModel[] {
  const sorted = [...models]

  switch (sortBy) {
    case SORT_OPTIONS.NAME:
      sorted.sort((a, b) =>
        (a.model_name || '').localeCompare(b.model_name || '')
      )
      break
    case SORT_OPTIONS.PRICE_LOW:
      sorted.sort((a, b) => getModelPrice(a) - getModelPrice(b))
      break
    case SORT_OPTIONS.PRICE_HIGH:
      sorted.sort((a, b) => getModelPrice(b) - getModelPrice(a))
      break
  }

  return sorted
}

/**
 * Apply all filters and sorting to models.
 *
 * `tagOptions` carries the operator tag registry (see `useTagRegistry`). It is
 * only consulted by the tag filter, and only registry-defined aliases need it:
 * the built-in vocabulary and plain spelling variants fold without it.
 */
export function filterAndSortModels(
  models: PricingModel[],
  filters: {
    search: string
    vendor: string
    group: string
    quotaType: string
    endpointType: string
    tag: string
    sortBy: string
  },
  tagOptions?: ResolveTagOptions
): PricingModel[] {
  let result = filterBySearch(models, filters.search)
  result = filterByVendor(result, filters.vendor)
  result = filterByGroup(result, filters.group)
  result = filterByQuotaType(result, filters.quotaType)
  result = filterByEndpointType(result, filters.endpointType)
  result = filterByTag(result, filters.tag, tagOptions)
  result = sortModels(result, filters.sortBy)

  return result
}

/**
 * Every distinct tag in the catalog, as canonical slugs, for the filter rail.
 *
 * Slugs rather than raw text because that is the identity the rest of the
 * feature agrees on: `Hot`, `hot` and `热门` are one entry, and `long context`
 * is one entry rather than the two grey fragments the old whitespace-splitting
 * parser produced. The rail resolves each slug back to a display label, so
 * nothing here has to preserve the operator's spelling.
 *
 * The returned values are what the tag filter state holds, and `filterByTag`
 * resolves model tags to the same slugs — that is the round trip.
 */
export function extractAllTags(
  models: PricingModel[],
  options?: ResolveTagOptions
): string[] {
  const slugs = new Set<string>()

  for (const model of models) {
    for (const tag of resolveTagList(model.tags, options)) {
      if (tag.slug) slugs.add(tag.slug)
    }
  }

  return [...slugs].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter models by tag.
 *
 * Both sides are reduced to canonical slugs, so a model tagged `Hot` matches a
 * chip for `hot` and a model tagged `long context` matches `long-context`.
 * `tag` is resolved rather than merely normalized so a value that arrived as an
 * alias — a bookmarked `?tag=popular`, say — still lands on `hot`.
 */
export function filterByTag(
  models: PricingModel[],
  tag: string,
  options?: ResolveTagOptions
): PricingModel[] {
  if (tag === FILTER_ALL) return models

  const target = resolveTag(tag, options).slug
  if (!target) return models

  return models.filter((m) =>
    resolveTagList(m.tags, options).some((item) => item.slug === target)
  )
}
