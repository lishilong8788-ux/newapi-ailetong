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

import type { ModelOption } from '../../types'
import { deriveModality } from '../capability'

/**
 * Joins the two sources the model library needs.
 *
 * `/api/user/models?group=X` is the authoritative list of what the current user
 * can actually call, and `/api/pricing` carries the catalog metadata (icon,
 * description, vendor, endpoint types). They are joined on model name rather
 * than filtering the catalog by group, so the library can never show a model
 * the user would get a 4xx on.
 *
 * Models missing from the catalog still render, using the bare name — dropping
 * them would silently hide something the user is entitled to use.
 */
export function buildModelCatalog(
  allowedModelNames: string[],
  pricingModels: PricingModel[] = [],
  vendors: PricingVendor[] = []
): ModelOption[] {
  const catalog = new Map(
    pricingModels.map((model) => [model.model_name, model])
  )
  const vendorsById = new Map(vendors.map((vendor) => [vendor.id, vendor]))

  return allowedModelNames.map((name) => {
    const entry = catalog.get(name)
    if (!entry) return { label: name, value: name }

    const vendor =
      entry.vendor_id === undefined
        ? undefined
        : vendorsById.get(entry.vendor_id)

    return {
      label: name,
      value: name,
      modality:
        deriveModality(entry.supported_endpoint_types, entry.tags) ?? undefined,
      description: entry.description,
      // Most models carry no icon of their own; the vendor mark is the next
      // best thing and is what makes the list scannable. Falling straight
      // through to a letter placeholder wastes real metadata.
      icon: entry.icon || vendor?.icon || entry.vendor_icon,
      tags: parseTags(entry.tags),
      vendorId: entry.vendor_id,
      // `/api/pricing` denormalises vendor fields onto each model, but the
      // top-level `vendors` array is the canonical copy, so prefer it.
      vendorName: vendor?.name ?? entry.vendor_name,
      vendorIcon: vendor?.icon ?? entry.vendor_icon,
      endpointTypes: entry.supported_endpoint_types,
    }
  })
}

function parseTags(tags?: string): string[] | undefined {
  if (!tags) return undefined
  const parsed = tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  return parsed.length > 0 ? parsed : undefined
}
