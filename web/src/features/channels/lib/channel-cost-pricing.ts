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
/**
 * One channel pricing row's arithmetic: cost in, sell price / discount / margin
 * out.
 *
 * The operator types one buy price per token kind plus one markup for the
 * channel. Everything else on the row is derived here rather than in the JSX, so
 * every column of a row comes from the same markup — a row that showed a sell
 * price off the per-model markup and a margin off the channel default would be
 * internally inconsistent and unverifiable.
 *
 * Unit throughout: USD per 1M tokens, matching what vendors publish so costs can
 * be copied verbatim. `per_call` is the exception and is USD per request.
 */

/** Markup is stored as a fraction (0.3) but typed as a percent (30). */
const MARKUP_PERCENT_PER_FRACTION = 100

export const MAX_MARKUP_PERCENT = 1000

/** Percent -> stored fraction, rounded so 30 does not round-trip as 0.30000000000000004. */
export function markupPercentToFraction(percent: number): number {
  return Math.round((percent / MARKUP_PERCENT_PER_FRACTION) * 10000) / 10000
}

/** Stored fraction -> percent, the inverse of the round-trip above. */
export function markupFractionToPercent(fraction: number): number {
  return Math.round(fraction * MARKUP_PERCENT_PER_FRACTION * 100) / 100
}

/**
 * Markup -> margin: markup ÷ (1 + markup).
 *
 * The two numbers are routinely confused — a 30% markup is a 23.1% margin, not
 * a 30% one — and the operator types the first while the cost report grades them
 * on the second. The summary strip prints both side by side so the conversion is
 * on screen rather than in someone's head.
 */
export function marginRateFromMarkupPercent(
  percent: number | null | undefined
): number {
  if (percent == null || !Number.isFinite(percent) || percent < 0) return 0
  const fraction = markupPercentToFraction(percent)
  return fraction / (1 + fraction)
}

/**
 * The markup a row actually prices at: its own override when set, the channel
 * default otherwise. Mirrors the backend resolution chain (per-model entry wins
 * over `default_markup`), so the table projects the price the channel will
 * really charge.
 *
 * A negative override is refused rather than clamped: it would sell below cost
 * on every request, and a silent clamp to 0 would hide that the operator typed
 * something they did not mean.
 */
export function resolveMarkupPercent(
  rowMarkupPercent: number | null | undefined,
  channelMarkupPercent: number | null | undefined
): number {
  if (
    rowMarkupPercent != null &&
    Number.isFinite(rowMarkupPercent) &&
    rowMarkupPercent >= 0
  ) {
    return rowMarkupPercent
  }
  if (
    channelMarkupPercent != null &&
    Number.isFinite(channelMarkupPercent) &&
    channelMarkupPercent >= 0
  ) {
    return channelMarkupPercent
  }
  return 0
}

/**
 * What a buy price on this kind actually does, which is not the same for all
 * eleven and the UI must not imply it is.
 *
 * - `billing` — the sell price derived from it reaches the bill.
 *   `SellPriceToRatios` emits a PriceData ratio for it and
 *   `applyChannelSellPrice` writes that ratio.
 * - `cost_only` — image output and reasoning tokens are subsets of the
 *   completion count with no ratio of their own, so they are charged at the
 *   output rate no matter what is typed here. The buy price still moves the
 *   margin report, which is the whole point of recording it.
 * - `per_call` — mutually exclusive with every per-token kind:
 *   `resolveModelCostExact` and `ResolveSellPrice` both take the per_call branch
 *   first and never read a token price.
 */
export type CostPricingReach = 'billing' | 'cost_only' | 'per_call'

export type CostPricingKind =
  | 'input'
  | 'output'
  | 'cache_read'
  | 'cache_write_5m'
  | 'cache_write_1h'
  | 'image_in'
  | 'image_out'
  | 'audio_in'
  | 'audio_out'
  | 'reasoning'
  | 'per_call'

/** Every kind, in the order the UI shows them. */
export const COST_PRICING_KINDS: ReadonlyArray<{
  key: CostPricingKind
  reach: CostPricingReach
}> = [
  { key: 'input', reach: 'billing' },
  { key: 'output', reach: 'billing' },
  { key: 'cache_read', reach: 'billing' },
  { key: 'cache_write_5m', reach: 'billing' },
  { key: 'cache_write_1h', reach: 'billing' },
  { key: 'image_in', reach: 'billing' },
  { key: 'image_out', reach: 'cost_only' },
  { key: 'audio_in', reach: 'billing' },
  { key: 'audio_out', reach: 'billing' },
  { key: 'reasoning', reach: 'cost_only' },
  { key: 'per_call', reach: 'per_call' },
]

/** The three the model list summarises: what nearly every model is priced on. */
export const PRIMARY_COST_PRICING_KINDS = COST_PRICING_KINDS.filter((kind) =>
  ['input', 'output', 'cache_read'].includes(kind.key)
)

/**
 * The price sheet's sections.
 *
 * Every per-token kind sits in one continuous sheet, so input / output / cache
 * are the first rows of the same table as the other seven rather than a
 * separate control above it. The split was what made the three read as
 * unrelated to everything under them.
 *
 * Reasoning sits with the text kinds instead of in a bucket of its own: it is a
 * subset of the completion count, which is exactly why it cannot carry a price
 * of its own and bills at the output rate.
 *
 * `per_call` is deliberately absent. It excludes every per-token kind, so the
 * panel offers it as a billing mode rather than as a twelfth row that silently
 * kills the eleven above it.
 */
export const COST_PRICING_GROUPS: ReadonlyArray<{
  id: string
  label: string
  keys: ReadonlyArray<CostPricingKind>
}> = [
  {
    id: 'text',
    label: 'Text tokens',
    keys: ['input', 'output', 'cache_read', 'reasoning'],
  },
  {
    id: 'cache_write',
    label: 'Cache writes',
    keys: ['cache_write_5m', 'cache_write_1h'],
  },
  {
    id: 'multimodal',
    label: 'Image & audio',
    keys: ['image_in', 'image_out', 'audio_in', 'audio_out'],
  },
]

/** Cost and the sell price it implies for one token kind. */
export type CostPricingDimension = {
  /** Buy price, straight from the input box. Null when not filled in. */
  cost: number | null
  /** Vendor list price, from the official-price sync. Null when never synced. */
  officialPrice: number | null
  /** cost × (1 + markup). Null when there is no cost to mark up. */
  sellPrice: number | null
  /**
   * sellPrice ÷ officialPrice, a 0-1 fraction. Null when either side is
   * missing — a discount against an unknown baseline is not a number, and
   * inventing one is how a row claims a saving it cannot support.
   */
  discountFraction: number | null
}

export type CostPricingRow = {
  model: string
  /** True when the row prices off the channel markup rather than its own. */
  inheritsChannelMarkup: boolean
  markupPercent: number
  /** True when the official-price sync has a list price for this model. */
  hasOfficialPrice: boolean
  /** One entry per kind, keyed so callers can iterate COST_PRICING_KINDS. */
  kinds: Record<CostPricingKind, CostPricingDimension>
  /**
   * (sell − cost) ÷ sell, which reduces to markup ÷ (1 + markup) and is
   * therefore the same for every token kind — one number per row, not eleven.
   * Null until at least one cost is filled in, because a margin on no cost is a
   * claim about a price the channel cannot charge yet.
   */
  marginRate: number | null
}

function toDimension(
  cost: number | undefined,
  officialPrice: number | undefined,
  markupFraction: number
): CostPricingDimension {
  const hasCost = cost != null && Number.isFinite(cost) && cost >= 0
  const hasOfficial =
    officialPrice != null && Number.isFinite(officialPrice) && officialPrice > 0
  const sellPrice = hasCost ? cost * (1 + markupFraction) : null

  return {
    cost: hasCost ? cost : null,
    officialPrice: hasOfficial ? officialPrice : null,
    sellPrice,
    discountFraction:
      sellPrice != null && hasOfficial ? sellPrice / officialPrice : null,
  }
}

export type CostPricingRowInput = {
  model?: string
  markupPercent?: number
  costs?: Partial<Record<CostPricingKind, number | undefined>>
}

/**
 * The official-price baseline, which exists for three kinds only:
 * `ratio_setting` publishes model / completion / cache official ratios and
 * nothing else, so cache write, image, audio and reasoning have no list price to
 * discount against and their `discountFraction` stays null.
 */
export type CostPricingOfficialPrice = {
  input?: number
  output?: number
  cacheRead?: number
}

/** One table row, with the channel markup as the fallback for its own. */
export function buildCostPricingRow(
  row: CostPricingRowInput,
  channelMarkupPercent: number | null | undefined,
  officialPrice: CostPricingOfficialPrice | undefined
): CostPricingRow {
  const inheritsChannelMarkup = !(
    row.markupPercent != null &&
    Number.isFinite(row.markupPercent) &&
    row.markupPercent >= 0
  )
  const markupPercent = resolveMarkupPercent(
    row.markupPercent,
    channelMarkupPercent
  )
  const markupFraction = markupPercentToFraction(markupPercent)

  const officialByKind: Partial<Record<CostPricingKind, number | undefined>> = {
    input: officialPrice?.input,
    output: officialPrice?.output,
    cache_read: officialPrice?.cacheRead,
  }

  const kinds = {} as Record<CostPricingKind, CostPricingDimension>
  let hasAnyCost = false
  for (const kind of COST_PRICING_KINDS) {
    kinds[kind.key] = toDimension(
      row.costs?.[kind.key],
      officialByKind[kind.key],
      markupFraction
    )
    if (kinds[kind.key].cost != null) hasAnyCost = true
  }

  return {
    model: row.model?.trim() ?? '',
    inheritsChannelMarkup,
    markupPercent,
    hasOfficialPrice: Boolean(officialPrice),
    kinds,
    marginRate: hasAnyCost ? markupFraction / (1 + markupFraction) : null,
  }
}

/**
 * How many of the eleven kinds this row has priced. Drives the count on the
 * model list, where the row is one line and the sheet that holds those prices
 * is off screen: without it, eight configured prices are as invisible as they
 * were when the panel had no field for them at all.
 */
export function countConfiguredKinds(row: CostPricingRow): number {
  return COST_PRICING_KINDS.filter((kind) => row.kinds[kind.key].cost != null)
    .length
}

export type CostPricingSummary = {
  /** Rows carrying a model name, priced or not. */
  namedCount: number
  /** Rows that would actually bill: a name plus at least one buy price. */
  pricedCount: number
  /** Rows whose row-level markup overrides the channel default. */
  overriddenCount: number
  /**
   * Median sell-price-over-list across every priced dimension on the table.
   *
   * Median, not mean: one model priced far off list (a free tier, a model the
   * vendor has since repriced) drags a mean far enough to misreport where the
   * channel actually sits. Only the three kinds with an official baseline can
   * contribute, since the others have no list price to divide by.
   */
  medianDiscountFraction: number | null
  /** Named models the official-price sync has no list price for. */
  modelsMissingOfficialPrice: string[]
}

/** The strip above the table: coverage, spread, and what is missing. */
export function summarizeCostPricingRows(
  rows: CostPricingRow[]
): CostPricingSummary {
  const discounts: number[] = []
  const modelsMissingOfficialPrice: string[] = []
  let namedCount = 0
  let pricedCount = 0
  let overriddenCount = 0

  for (const row of rows) {
    if (!row.model) continue
    namedCount += 1
    if (!row.inheritsChannelMarkup) overriddenCount += 1
    // Any kind counts as priced, not just the three with columns: a model
    // priced only on audio or per-request does bill, and reporting it as
    // unpriced would send the operator looking for a price they already set.
    if (COST_PRICING_KINDS.some((kind) => row.kinds[kind.key].cost != null)) {
      pricedCount += 1
    }
    if (!row.hasOfficialPrice) modelsMissingOfficialPrice.push(row.model)
    for (const kind of COST_PRICING_KINDS) {
      const fraction = row.kinds[kind.key].discountFraction
      if (fraction != null) discounts.push(fraction)
    }
  }

  discounts.sort((a, b) => a - b)
  const middle = Math.floor(discounts.length / 2)
  let medianDiscountFraction: number | null = null
  if (discounts.length > 0) {
    medianDiscountFraction =
      discounts.length % 2 === 0
        ? (discounts[middle - 1] + discounts[middle]) / 2
        : discounts[middle]
  }

  return {
    namedCount,
    pricedCount,
    overriddenCount,
    medianDiscountFraction,
    modelsMissingOfficialPrice,
  }
}

/** USD / 1M tokens, the unit every price column in this table is in. */
export function formatUsdPerMillion(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `$${Number(value.toFixed(4))}`
}

export function formatMarginRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '-'
  return `${Number((rate * 100).toFixed(1))}%`
}
