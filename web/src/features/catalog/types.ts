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
import type { Channel } from '@/features/channels/types'
import type { Model } from '@/features/models/types'
import type { ChannelRoute, PricingModel } from '@/features/pricing/types'

/**
 * What state one catalog entry is in, from an operator's point of view.
 *
 * The four values are deliberately ordered by how urgently they need attention,
 * and every one of them is derivable from data the frontend already fetches —
 * nothing here is a guess:
 *
 * - `unpriced`: the model is on sale and reachable, but no price was ever
 *   configured, so the relay bills it off a fallback constant. This is the one
 *   state that is actively losing money, which is why it sorts first.
 * - `blocked`: at least one enabled channel lists the model, yet it never
 *   appears in `/api/pricing`. Either its metadata row is disabled or no ability
 *   row survived, so a customer cannot buy what an operator believes is live.
 * - `out_of_stock`: configured on a channel, but no *enabled* channel carries
 *   it. Nothing to sell.
 * - `on_sale`: reachable and priced.
 */
export type CatalogStatus = 'on_sale' | 'unpriced' | 'blocked' | 'out_of_stock'

/** One row in the left rail: a model, plus how it is currently being sold. */
export type CatalogItem = {
  /** Client-facing model name. The identity of a catalog entry. */
  modelName: string
  status: CatalogStatus
  /**
   * The `/api/pricing` row, when the model is actually on sale. Absent for
   * `blocked` / `out_of_stock` entries — those exist only in channel config, so
   * there is no price, vendor or group data to show for them.
   */
  pricing?: PricingModel
  /** Vendor label for grouping. Falls back to the keyword-derived category. */
  vendorName: string
  vendorIcon?: string
  /** Channels whose model list contains this model, enabled or not. */
  channelCount: number
  /** Of those, the ones currently enabled. Zero means out of stock. */
  enabledChannelCount: number
  /**
   * The `model` metadata row this entry is named by, when one exists.
   *
   * Absent for a name that only ever appeared in a channel's model list: those
   * relay fine but carry no vendor, description or tags, and an operator who
   * wants any of that has to create the row. Editing needs the row's `id`, which
   * `/api/pricing` does not carry, so it is joined in here from `/api/models`.
   */
  model?: Model
}

/** Left-rail grouping: one vendor and the models under it. */
export type CatalogVendorGroup = {
  vendorName: string
  vendorIcon?: string
  items: CatalogItem[]
}

export type CatalogStatusCounts = Record<CatalogStatus, number>

/**
 * One supplier line for one model: the channel, and what it costs there.
 *
 * Built from raw channel config rather than from `/api/pricing/channels` alone,
 * because a channel that is disabled or whose ability row is missing is absent
 * from that endpoint while still being the thing the operator has to fix. The
 * route is joined on when it exists and simply missing when it does not, which
 * is exactly the `serving` distinction.
 */
export type CatalogSupplyRow = {
  channel: Channel
  /** Present when this channel currently serves the model through the relay. */
  route?: ChannelRoute
  /**
   * The name this channel sends upstream, after walking `model_mapping`. Cost is
   * keyed by this name, not by the client-facing one, so it is resolved once
   * here and reused by both the price columns and the cost editor.
   */
  upstreamModel: string
  /** True when an enabled channel serves the model — i.e. a route exists. */
  serving: boolean
}
