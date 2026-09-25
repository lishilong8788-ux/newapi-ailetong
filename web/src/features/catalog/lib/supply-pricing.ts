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
  markupPercentToFraction,
  markupFractionToPercent,
  resolveMarkupPercent,
} from '@/features/channels/lib'

import { readChannelCostSettings } from './build-supply'
import type { CatalogSupplyRow } from '../types'

/**
 * What one line costs and charges for one model, in USD / 1M tokens.
 *
 * Read off the channel's own stored `cost` config rather than off the route's
 * ratios, for two reasons. The cost is only ever stored per channel, so it has
 * no other source; and deriving the sell price from the same numbers the cost
 * dialog edits means the table and the dialog cannot disagree — the alternative
 * (buy from settings, sell from `/api/pricing/channels`) shows a stale sell price
 * for the whole minute the backend caches the pricing payload.
 *
 * `perCall` is exclusive with the token prices: the backend takes that branch
 * first and never reads a token rate, so a row with it set has no input/output
 * price to show.
 */
export type SupplyPricing = {
  /** Buy price for input tokens, the one dimension nearly every model has. */
  buyInput: number | null
  /** Buy price for output tokens. */
  buyOutput: number | null
  sellInput: number | null
  sellOutput: number | null
  /** USD per request, when the line is priced per call instead of per token. */
  perCallBuy: number | null
  perCallSell: number | null
  /** markup ÷ (1 + markup) — one figure for the whole row, not per dimension. */
  marginRate: number | null
  /** The markup this model prices at: its own override, else the channel default. */
  markupPercent: number
  /** True when a per-model markup overrides the channel default. */
  hasModelMarkup: boolean
  /** True when nothing is configured, so the line bills the platform price. */
  unpriced: boolean
}

export function resolveSupplyPricing(row: CatalogSupplyRow): SupplyPricing {
  const cost = readChannelCostSettings(row.channel.settings)
  const entry = cost?.models?.[row.upstreamModel]

  const channelMarkupPercent =
    typeof cost?.default_markup === 'number' && cost.default_markup >= 0
      ? markupFractionToPercent(cost.default_markup)
      : undefined
  const modelMarkupPercent =
    typeof entry?.markup === 'number' && entry.markup >= 0
      ? markupFractionToPercent(entry.markup)
      : undefined

  const markupPercent = resolveMarkupPercent(
    modelMarkupPercent,
    channelMarkupPercent
  )
  const markupFraction = markupPercentToFraction(markupPercent)

  const buyInput = finiteOrNull(entry?.input)
  const buyOutput = finiteOrNull(entry?.output)
  const perCallBuy = finiteOrNull(entry?.per_call)
  const hasAnyCost =
    buyInput != null ||
    buyOutput != null ||
    perCallBuy != null ||
    Object.values(entry ?? {}).some(
      (value) => typeof value === 'number' && Number.isFinite(value)
    )

  const sell = (value: number | null) =>
    value == null ? null : value * (1 + markupFraction)

  return {
    buyInput,
    buyOutput,
    sellInput: sell(buyInput),
    sellOutput: sell(buyOutput),
    perCallBuy,
    perCallSell: sell(perCallBuy),
    marginRate: hasAnyCost ? markupFraction / (1 + markupFraction) : null,
    markupPercent,
    hasModelMarkup: modelMarkupPercent != null,
    unpriced: !hasAnyCost,
  }
}

function finiteOrNull(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  return value
}
