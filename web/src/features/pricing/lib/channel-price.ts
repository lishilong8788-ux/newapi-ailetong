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
import type { ChannelRoute, PricingModel } from '../types'

// ----------------------------------------------------------------------------
// Per-channel price tiers
// ----------------------------------------------------------------------------
//
// A channel tier answers "what does this line charge", which is a different
// question from the per-group cards' "what do you pay". The difference is the
// group ratio: it belongs to the asker, not to the line, and the group cards
// already show it. So every function here deliberately prices at group ratio 1.
//
// The tier price itself comes from the backend as a ratio triple in the same unit
// as `PricingModel.model_ratio`, which lets the whole existing pipeline —
// output/cache multipliers, token unit, currency, recharge rate — produce the
// channel column with no second price formatter.

/**
 * The model as this channel prices it.
 *
 * `enable_groups` is emptied on purpose: `getDisplayGroupRatio` reads it to pick
 * the viewer's best group ratio, and an empty list makes it answer 1. That is the
 * whole mechanism keeping the group multiplier out of a channel tier.
 *
 * The official ratios are carried over untouched, so the discount column keeps
 * comparing against the vendor's published price. For a channel with a
 * configured discount that comparison reproduces the discount itself (the
 * backend built `model_ratio` as official × discount); for a fallback channel it
 * reproduces the catalog's own platform-vs-official discount, which is the
 * honest number because a fallback channel bills exactly what the catalog says.
 */
export function toChannelPricedModel(
  model: PricingModel,
  route: ChannelRoute
): PricingModel {
  return {
    ...model,
    enable_groups: [],
    group_ratio: {},
    model_ratio: route.price.model_ratio,
    completion_ratio: route.price.completion_ratio ?? Number.NaN,
    cache_ratio: route.price.cache_ratio ?? null,
    // Kinds the channel price does not cover. Left unset so a row with no
    // channel-level rate reads `-` instead of borrowing the platform multiplier
    // and printing a number the discount never touched.
    create_cache_ratio: null,
    image_ratio: null,
    audio_ratio: null,
    audio_completion_ratio: null,
    price_unset: route.price.price_unset,
  }
}

/**
 * The model as this channel prices it, *with* the group multipliers left in
 * place.
 *
 * The sibling `toChannelPricedModel` empties `enable_groups` so a channel tier
 * reads as the channel's own rate, undivided by whichever group the viewer
 * happens to sit in. That is right for the channel cards in the route list, and
 * wrong for the group cards: what a request actually costs is the
 * channel's rate scaled by the group's ratio, so the group list has to keep both
 * factors. Pass the result to `getPriceComparison` with a `selectedGroup` and the
 * platform column comes out as channel × group.
 *
 * Official ratios ride along untouched, so each group card's discount column
 * still compares against the vendor's published price rather than against the
 * channel's own rate.
 */
export function toChannelGroupPricedModel(
  model: PricingModel,
  route: ChannelRoute
): PricingModel {
  return {
    ...toChannelPricedModel(model, route),
    enable_groups: model.enable_groups,
    group_ratio: model.group_ratio,
  }
}

/**
 * The discount to badge on a channel card, or null when there is nothing to
 * claim.
 *
 * Only a configured discount counts. A fallback channel's price equals the
 * catalog's platform price, and that comparison is already badged on the model
 * header — repeating it per channel would read as four channels each cutting
 * their own deal when in fact none of them has one.
 */
export function getChannelDiscount(route: ChannelRoute): number | null {
  const discount = route.price.discount
  if (discount == null || !Number.isFinite(discount)) return null
  return discount > 0 && discount < 1 ? discount : null
}

/**
 * True when this row's price is the channel's own — a buy price marked up, or a
 * discount against list — rather than the platform default every channel shares.
 */
export function isChannelPriced(route: ChannelRoute): boolean {
  return (
    route.price.price_source !== 'fallback' &&
    route.price.model_ratio > 0 &&
    !route.price.price_unset
  )
}

/**
 * Lowest and highest configured discount across the routes, for the auto-route
 * card's "4.4折 – 7.8折" range.
 *
 * Null when fewer than one channel has a discount: a range needs something to
 * span, and a single unconfigured install would otherwise advertise "10折 – 10折".
 * Routes without a discount are skipped rather than counted as 1.0, which would
 * stretch every range up to list price the moment one channel went unconfigured.
 */
export function getDiscountRange(
  routes: ChannelRoute[]
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const route of routes) {
    const discount = getChannelDiscount(route)
    if (discount == null) continue
    if (discount < min) min = discount
    if (discount > max) max = discount
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

/**
 * The label for one line: the operator's line code, else the channel name when
 * the viewer is an admin and the endpoint sent one, else the channel id.
 *
 * The id is a deliberate last resort rather than a nicety. It identifies the
 * line well enough for a reader comparing rows without naming the supplier,
 * which is what a channel name usually does.
 */
export function getChannelLabel(route: ChannelRoute): string {
  if (route.code) return route.code
  if (route.name) return route.name
  return `#${route.channel_id}`
}

/**
 * The string a customer actually puts in `model` to reach one line.
 *
 * `<model>/<code>` is a backend contract, not a display convention: the
 * distributor splits the suffix off before anything else reads the model name
 * (`model.SplitModelLineCode`), pins the request to channels publishing that
 * code, and falls back to the full candidate list when the line is down. So a
 * line-coded name is a preference and never a different model — pricing, the
 * token model limit and logging all still see the bare name.
 *
 * Without a code the bare model name is the only callable string: a channel the
 * operator gave no line code can be reached by automatic routing alone.
 */
export function getClientModelName(
  modelName: string,
  lineCode?: string
): string {
  if (!lineCode) return modelName
  return `${modelName}/${lineCode}`
}
