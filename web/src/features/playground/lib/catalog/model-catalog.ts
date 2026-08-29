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
import { CAPABILITY_REGISTRY, deriveModality } from '../capability'

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

  return allowedModelNames.flatMap<ModelOption>((name) => {
    const entry = catalog.get(name)
    if (!entry) return [{ label: name, value: name }]

    // Unpriced models are dropped from the playground entirely.
    //
    // The relay rejects them before any upstream call, so there is no state in
    // which one is useful here. They were the bulk of a 640-model list — mostly
    // Cloudflare and Yi entries nobody had priced — and every one of them was a
    // trap: pick it, type a prompt, get an error. Badging them made the list
    // longer, not clearer.
    //
    // This is deliberately narrow. Only a model that appeared in `/api/pricing`
    // *and* carried no configured rate is hidden. A model absent from the
    // catalog keeps its bare-name entry above, because a failed catalog request
    // must not empty the library — see `getUserModels`.
    //
    // `/api/user/models` still lists them and the API still serves them under
    // the same rules as before; this only decides what the picker offers.
    if (entry.price_unset) return []

    const modality =
      deriveModality(entry.supported_endpoint_types, entry.tags) ?? undefined

    // Models whose modality has no backend route are dropped for the same
    // reason as unpriced ones: the submit path 404s, so listing them offers a
    // choice that cannot be taken. Video and audio are in this state.
    //
    // `routed` is checked, not `available`: a modality that is routed but not yet
    // verified from the browser stays listed and carries the "coming soon" badge,
    // because the choice can be taken even if nobody has confirmed the result.
    if (modality && !CAPABILITY_REGISTRY[modality].routed) return []

    const vendor =
      entry.vendor_id === undefined
        ? undefined
        : vendorsById.get(entry.vendor_id)

    return [
      {
        label: name,
        value: name,
        modality,
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
        pricing: entry,
      },
    ]
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
