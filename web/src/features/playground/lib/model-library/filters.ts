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
import type { StatusVariant } from '@/components/status-badge'

import type { ModelOption } from '../../types'
import type { PlaygroundModality } from '../capability'

/** Sentinel for "no filter applied", shared by the modality and vendor filters. */
export const FILTER_ALL = 'all' as const

export type ModalityFilter = PlaygroundModality | typeof FILTER_ALL

/**
 * Tab order is deliberate: chat first because it carries most of the traffic.
 *
 * Labels here and in `MODALITY_LABELS` are English source strings used as
 * i18next keys, matching the project convention — this module is plain data, so
 * the consuming component resolves them through `t()`.
 */
export const MODALITY_TABS: Array<{
  value: ModalityFilter
  labelKey: string
}> = [
  { value: FILTER_ALL, labelKey: 'All' },
  { value: 'chat', labelKey: 'Chat' },
  { value: 'image', labelKey: 'Image' },
  // Video and audio are absent by construction, not by oversight: their models
  // are filtered out of the catalog (no backend route — see `routed` in the
  // capability registry), so both tabs would only ever show an empty list.
  // Re-add alongside the route.
]

export const MODALITY_LABELS: Record<PlaygroundModality, string> = {
  chat: 'Chat',
  image: 'Image',
  video: 'Video',
  audio: 'Speech',
}

/**
 * Badge colour per modality, drawn from the shared `StatusVariant` palette.
 *
 * Colour is what makes the list scannable: at a glance the eye sorts by hue
 * before it reads any label, so a wall of identical grey badges is the same as
 * having no badges at all.
 */
export const MODALITY_VARIANTS: Record<PlaygroundModality, StatusVariant> = {
  chat: 'blue',
  image: 'cyan',
  video: 'orange',
  audio: 'success',
}

export type ModelFilterState = {
  modality: ModalityFilter
  vendor: string
  search: string
}

export const INITIAL_FILTER_STATE: ModelFilterState = {
  modality: FILTER_ALL,
  vendor: FILTER_ALL,
  search: '',
}

/**
 * Applies all three filters. Matching is case-insensitive and covers the model
 * name plus its description, so a search for "代码" finds models whose name
 * gives no hint of what they are good at.
 */
export function filterModels(
  models: ModelOption[],
  { modality, vendor, search }: ModelFilterState
): ModelOption[] {
  const query = search.trim().toLowerCase()

  return models.filter((model) => {
    if (modality !== FILTER_ALL && model.modality !== modality) return false

    if (vendor !== FILTER_ALL && String(model.vendorId ?? '') !== vendor) {
      return false
    }

    if (!query) return true

    return (
      model.value.toLowerCase().includes(query) ||
      (model.description?.toLowerCase().includes(query) ?? false)
    )
  })
}

/**
 * Counts per modality tab, computed against the vendor and search filters but
 * *not* the modality filter — a tab has to show how many models it holds even
 * while a different tab is active.
 */
export function countByModality(
  models: ModelOption[],
  filters: ModelFilterState
): Record<ModalityFilter, number> {
  const scoped = filterModels(models, { ...filters, modality: FILTER_ALL })
  const counts = {
    [FILTER_ALL]: scoped.length,
    chat: 0,
    image: 0,
    video: 0,
    audio: 0,
  } as Record<ModalityFilter, number>

  for (const model of scoped) {
    if (model.modality) counts[model.modality] += 1
  }
  return counts
}

export type VendorFilterOption = {
  value: string
  label: string
  icon?: string
  count: number
}

/**
 * Vendor options with counts, scoped by the active modality and search so the
 * numbers match what selecting one would actually yield.
 *
 * Sorted by count descending: the vendors a deployment actually leans on float
 * to the top instead of being ordered by an id the user never sees.
 */
export function buildVendorOptions(
  models: ModelOption[],
  filters: ModelFilterState
): VendorFilterOption[] {
  const scoped = filterModels(models, { ...filters, vendor: FILTER_ALL })
  const byVendor = new Map<string, VendorFilterOption>()

  for (const model of scoped) {
    if (model.vendorId === undefined) continue
    const key = String(model.vendorId)
    const existing = byVendor.get(key)

    if (existing) {
      existing.count += 1
      continue
    }

    byVendor.set(key, {
      value: key,
      label: model.vendorName ?? key,
      icon: model.vendorIcon,
      count: 1,
    })
  }

  return [
    // The sentinel's label is an English source string resolved through `t()` by
    // the filter component; every other label is a vendor name from the backend
    // and must render verbatim.
    { value: FILTER_ALL, label: 'All vendors', count: scoped.length },
    ...[...byVendor.values()].sort((a, b) => b.count - a.count),
  ]
}
