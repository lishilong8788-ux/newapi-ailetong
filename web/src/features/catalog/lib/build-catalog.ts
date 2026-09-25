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
import { CHANNEL_STATUS } from '@/features/channels/constants'
import { getModelCategory, parseModelsList } from '@/features/channels/lib'
import type { Channel } from '@/features/channels/types'
import type { Model } from '@/features/models/types'
import type { PricingModel, PricingVendor } from '@/features/pricing/types'

import type {
  CatalogItem,
  CatalogStatus,
  CatalogStatusCounts,
  CatalogVendorGroup,
} from '../types'

/** How many channels carry one model, split by whether the channel is enabled. */
type ChannelTally = { total: number; enabled: number }

/**
 * Model name -> channel tally, built from each channel's own model list.
 *
 * Counted off `channel.models` rather than off `/api/pricing`, because the two
 * disagree in exactly the cases an operator needs to see: a model configured on
 * a disabled channel, or on an enabled one whose metadata row is switched off,
 * is absent from the pricing catalog while still sitting in channel config.
 * Tallying the raw config is what makes `blocked` and `out_of_stock` visible.
 */
export function tallyChannelsByModel(
  channels: readonly Channel[]
): Map<string, ChannelTally> {
  const tally = new Map<string, ChannelTally>()

  for (const channel of channels) {
    const isEnabled = channel.status === CHANNEL_STATUS.ENABLED
    // A tag aggregate row repeats the models of the children beneath it, so
    // counting it would double every model under a tagged channel group.
    for (const modelName of new Set(parseModelsList(channel.models ?? ''))) {
      const entry = tally.get(modelName) ?? { total: 0, enabled: 0 }
      entry.total += 1
      if (isEnabled) entry.enabled += 1
      tally.set(modelName, entry)
    }
  }

  return tally
}

/**
 * Which state a catalog entry is in.
 *
 * `pricing` present means the model survived every gate between channel config
 * and the sell-side catalog (enabled ability, enabled metadata row), so the only
 * question left is whether it carries a price. `price_unset` is the backend's own
 * flag for "no price or ratio was ever configured", which is why it is trusted
 * here instead of being re-derived from the ratio.
 */
export function resolveCatalogStatus(
  pricing: PricingModel | undefined,
  tally: ChannelTally | undefined
): CatalogStatus {
  if (pricing) {
    return pricing.price_unset ? 'unpriced' : 'on_sale'
  }
  // Not in the catalog. An enabled channel still listing it means the block is
  // downstream of the channel (disabled metadata row, missing ability); no
  // enabled channel at all is plain out of stock.
  return (tally?.enabled ?? 0) > 0 ? 'blocked' : 'out_of_stock'
}

/** Attention-first ordering, mirroring the `CatalogStatus` doc comment. */
const STATUS_WEIGHT: Record<CatalogStatus, number> = {
  unpriced: 0,
  blocked: 1,
  out_of_stock: 2,
  on_sale: 3,
}

/**
 * Every model worth showing an operator, from both directions at once: what the
 * catalog is selling, and what the channels are configured to serve.
 *
 * The union is the point. Reading only `/api/pricing` hides everything broken —
 * that endpoint is built from *enabled* abilities joined against *enabled*
 * metadata rows, so a misconfigured model is invisible there by construction.
 * Reading only channel config loses vendor, price and group data. Neither side
 * alone can answer "what am I selling, and what is broken".
 */
export function buildCatalog(
  pricingModels: readonly PricingModel[],
  channels: readonly Channel[],
  modelRows: readonly Model[] = [],
  vendors: readonly PricingVendor[] = []
): CatalogItem[] {
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]))
  const tallies = tallyChannelsByModel(channels)
  const pricingByName = new Map(pricingModels.map((m) => [m.model_name, m]))
  const modelByName = new Map(modelRows.map((row) => [row.model_name, row]))
  // Metadata rows join in as a third source of names, not just as decoration on
  // the other two: a model whose row exists but is switched off appears in
  // neither the pricing catalog nor any channel list, and leaving it out would
  // hide the row an operator has to re-enable.
  const names = new Set([
    ...pricingByName.keys(),
    ...tallies.keys(),
    ...modelByName.keys(),
  ])

  const items = [...names].map((modelName) => {
    const pricing = pricingByName.get(modelName)
    const tally = tallies.get(modelName)
    const modelRow = modelByName.get(modelName)
    // A disabled metadata row is absent from `/api/pricing`, so its vendor has to
    // come off the row itself or the model would be filed under a keyword guess
    // while the operator can plainly see which vendor they assigned it to.
    const rowVendor = modelRow?.vendor_id
      ? vendorById.get(modelRow.vendor_id)
      : undefined

    return {
      modelName,
      status: resolveCatalogStatus(pricing, tally),
      pricing,
      model: modelRow,
      // Vendor first, keyword category second. A model with no metadata row has
      // no vendor at all, and dropping it into one bucket labelled "Other" would
      // collapse most of a fresh install into a single unusable group.
      vendorName:
        pricing?.vendor_name || rowVendor?.name || getModelCategory(modelName),
      vendorIcon: pricing?.vendor_icon || rowVendor?.icon,
      channelCount: tally?.total ?? 0,
      enabledChannelCount: tally?.enabled ?? 0,
    } satisfies CatalogItem
  })

  return items.sort(
    (a, b) =>
      STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] ||
      a.modelName.localeCompare(b.modelName)
  )
}

/**
 * Group the catalog by vendor for the left rail.
 *
 * Vendors are ordered by how much attention they need — the count of non-
 * `on_sale` entries — and then by size. An operator opening this page is looking
 * for what is wrong, and alphabetical order buries a single broken model under
 * whichever vendor happens to start with an 'A'.
 */
export function groupCatalogByVendor(
  items: readonly CatalogItem[]
): CatalogVendorGroup[] {
  const groups = new Map<string, CatalogVendorGroup>()

  for (const item of items) {
    const group = groups.get(item.vendorName)
    if (group) {
      group.items.push(item)
      // The icon travels with the vendor, but only pricing rows carry one, so
      // the first row that has it fills in the group for the rest.
      group.vendorIcon ??= item.vendorIcon
      continue
    }
    groups.set(item.vendorName, {
      vendorName: item.vendorName,
      vendorIcon: item.vendorIcon,
      items: [item],
    })
  }

  const needsAttention = (group: CatalogVendorGroup) =>
    group.items.reduce(
      (count, item) => count + (item.status === 'on_sale' ? 0 : 1),
      0
    )

  return [...groups.values()].sort(
    (a, b) =>
      needsAttention(b) - needsAttention(a) ||
      b.items.length - a.items.length ||
      a.vendorName.localeCompare(b.vendorName)
  )
}

export function countCatalogStatuses(
  items: readonly CatalogItem[]
): CatalogStatusCounts {
  const counts: CatalogStatusCounts = {
    on_sale: 0,
    unpriced: 0,
    blocked: 0,
    out_of_stock: 0,
  }
  for (const item of items) {
    counts[item.status] += 1
  }
  return counts
}
