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
 * The operator types two numbers per model (input and output cost) plus one
 * markup for the channel. Everything else on the row is derived here rather
 * than in the JSX, so every column of a row comes from the same markup — a row
 * that showed a sell price off the per-model markup and a margin off the
 * channel default would be internally inconsistent and unverifiable.
 *
 * Unit throughout: USD per 1M tokens, matching what vendors publish so costs
 * can be copied verbatim.
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
  input: CostPricingDimension
  output: CostPricingDimension
  /**
   * (sell − cost) ÷ sell, which reduces to markup ÷ (1 + markup) and is
   * therefore the same for every token kind — one number per row, not two.
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
  input?: number
  output?: number
  markupPercent?: number
}

/** One table row, with the channel markup as the fallback for its own. */
export function buildCostPricingRow(
  row: CostPricingRowInput,
  channelMarkupPercent: number | null | undefined,
  officialPrice: { input?: number; output?: number } | undefined
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
  const input = toDimension(row.input, officialPrice?.input, markupFraction)
  const output = toDimension(row.output, officialPrice?.output, markupFraction)
  const hasAnyCost = input.cost != null || output.cost != null

  return {
    model: row.model?.trim() ?? '',
    inheritsChannelMarkup,
    markupPercent,
    hasOfficialPrice: Boolean(officialPrice),
    input,
    output,
    marginRate: hasAnyCost ? markupFraction / (1 + markupFraction) : null,
  }
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
   * channel actually sits. Input and output land in the same pool because
   * they are discounted against two different list prices and there is no
   * request mix here to weight them by — pooling says "half the prices this
   * channel quotes are under this", which is true whatever the mix.
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
    if (row.input.cost != null || row.output.cost != null) pricedCount += 1
    if (!row.hasOfficialPrice) modelsMissingOfficialPrice.push(row.model)
    for (const dimension of [row.input, row.output]) {
      if (dimension.discountFraction != null) {
        discounts.push(dimension.discountFraction)
      }
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

/**
 * Collapses the input/output pair into what one cell prints: a single value
 * when both sides agree, `a / b` when they do not.
 *
 * Input and output are marked up identically but are discounted against two
 * different list prices, so their discounts genuinely can differ. Printing one
 * of them alone would be a guess about which one the operator meant.
 */
export function formatPricePair(input: string, output: string): string {
  return input === output ? input : `${input} / ${output}`
}
