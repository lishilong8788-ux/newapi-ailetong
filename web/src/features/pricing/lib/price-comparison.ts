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
import { QUOTA_TYPE_VALUES } from '../constants'
import type { PriceType, PricingModel, TokenUnit } from '../types'
import {
  getDynamicPricingSummary,
  getDynamicUnitPrice,
  isDynamicPricingModel,
} from './dynamic-price'
import { getDisplayGroupRatio } from './model-helpers'
import {
  formatFixedPrice,
  formatTokenUnitPrice,
  getTokenUnitPrice,
  toOfficiallyPricedModel,
} from './price'

// ----------------------------------------------------------------------------
// Platform / official-price comparison
// ----------------------------------------------------------------------------
//
// The pricing card shows three numbers per price type: what the customer pays
// (platform price, group ratio applied), the vendor's own published price
// (official price), and platform ÷ official rendered as a discount.
//
// The reference used to be "this site's price at group ratio 1.0", which made
// the discount column a restatement of the group ratio — a number measuring how
// one group is priced against another group here, not how this site is priced
// against the vendor. A `default` group at ratio 1 therefore showed no discount
// no matter how far below list price it actually sat, and a 0.5 group showed
// "5折" whether or not that beat buying from the vendor directly.
//
// So the reference is now `official_*_ratio`, synced from public vendor pricing
// and stored separately from anything billing reads. Two consequences worth
// knowing:
//
//   - Platform price and official price answer different questions. The platform
//     price comes from `model_ratio`, which operations set from cost plus margin
//     and which has no arithmetic relationship to the vendor's list price. The
//     official price only ever decides what the discount label says.
//   - A model the sync has never seen has no official price, and its official
//     and discount cells read `-`. That is the honest state: no comparison
//     exists. `hasOfficialPrice` is false for a model where no row has one, so
//     callers can collapse the columns entirely.
//
// The group ratio is still exposed as `ratio` — group badges legitimately show
// it — but it no longer feeds the discount.

/** A synthetic single-entry ratio map, so group-aware formatters can be reused. */
const SYNTHETIC_GROUP = '_cmp'

export type PriceComparisonOptions = {
  tokenUnit: TokenUnit
  showRechargePrice?: boolean
  priceRate?: number
  usdExchangeRate?: number
  /** Active group filter; falls back to the model's best available ratio. */
  selectedGroup?: string
  /**
   * Whether to include the cached-input row. Grid cards pass `false`: cache
   * pricing is a tuning detail that only matters once you've picked a model, and
   * a third row costs real height in a four-column layout. Defaults to `true`
   * so the details view keeps the full breakdown.
   */
  includeCache?: boolean
}

export type PriceComparisonRow = {
  key: string
  /** i18n key for the price type, e.g. `Input`. */
  labelKey: string
  /** Price the customer is charged, group ratio applied. */
  platform: string
  /** The vendor's published price for this row; `-` when none is known. */
  official: string
  /**
   * `platform / official` for this row, already rounded to two decimals so
   * `formatDiscount`'s tenths render as one decimal ("4.4折", not "4.37折").
   *
   * Null when there is nothing to claim: no official price, or the platform
   * price is not actually below it. A ratio that rounds up to 1 counts as not
   * below — "10折" is not a discount.
   */
  discountRatio: number | null
}

export type PriceComparison = {
  rows: PriceComparisonRow[]
  /**
   * Effective group ratio the platform column was computed with. Still the right
   * number for a group badge; deliberately not the discount (see the note at the
   * top of this file).
   */
  ratio: number
  /** False when ratio >= 1, i.e. this group is not priced below the site standard. */
  hasDiscount: boolean
  /** True when at least one row can be compared against an official price. */
  hasOfficialPrice: boolean
  /**
   * The headline discount: the input row's, and only ever the input row's. Drives
   * the badge on the card and in the details header.
   *
   * Deliberately not "the first row that has a discount". Rows can disagree —
   * live data has a model at 3.8折 on input and 6.0折 on output — so falling
   * through to another row would put a number on the badge that the row the
   * reader looks at first contradicts with a `-`.
   */
  officialDiscountRatio: number | null
  /** Per-request models render a single row with no token unit suffix. */
  isPerRequest: boolean
  /**
   * Set when the model uses a billing expression that could not be parsed into
   * tiers; callers should fall back to showing the raw expression.
   */
  specialExpression?: string
}

export function getPriceComparison(
  model: PricingModel,
  options: PriceComparisonOptions
): PriceComparison {
  const ratio = getDisplayGroupRatio(model, options.selectedGroup)
  const hasDiscount = Number.isFinite(ratio) && ratio > 0 && ratio < 1

  let built: BuiltRows
  let isPerRequest = false

  if (isDynamicPricingModel(model)) {
    built = buildDynamicRows(model, options, ratio)
  } else if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    isPerRequest = true
    built = {
      // Per-request billing has no official counterpart to compare against.
      hasOfficialPrice: false,
      inputDiscountRatio: null,
      rows: [
        {
          key: 'request',
          labelKey: 'Per request',
          platform: formatRequest(model, options, ratio),
          official: formatTokenUnitPrice(Number.NaN),
          discountRatio: null,
        },
      ],
    }
  } else {
    built = buildTokenRows(model, options, ratio)
  }

  return {
    ratio,
    hasDiscount,
    isPerRequest,
    rows: built.rows,
    specialExpression: built.specialExpression,
    hasOfficialPrice: built.hasOfficialPrice,
    officialDiscountRatio: built.inputDiscountRatio,
  }
}

/**
 * A built row set plus the two facts about it that cannot be read back off the
 * rendered rows.
 *
 * `hasOfficialPrice` is tracked rather than inferred from the `official` strings:
 * whether a comparison exists is a fact about the data, and recovering it from
 * display text would make the columns depend on how a currency happens to format.
 *
 * `inputDiscountRatio` is reported by the builder rather than picked out of
 * `rows` by the caller, so the headline badge is tied to the input row by
 * construction instead of by row order.
 */
type BuiltRows = {
  rows: PriceComparisonRow[]
  hasOfficialPrice: boolean
  inputDiscountRatio: number | null
  specialExpression?: string
}

/**
 * `platform / official`, or null when the pair supports no discount claim.
 *
 * Rounded to two decimals before the comparison so the value handed to
 * `formatDiscount` prints one decimal place, and so a price that rounds to
 * exactly 1 is rejected rather than shown as "10折".
 */
function calcDiscountRatio(platform: number, official: number): number | null {
  if (!Number.isFinite(platform) || !Number.isFinite(official)) return null
  if (platform <= 0 || official <= 0) return null
  const rounded = Math.round((platform / official) * 100) / 100
  return rounded > 0 && rounded < 1 ? rounded : null
}

function buildTokenRows(
  model: PricingModel,
  options: PriceComparisonOptions,
  ratio: number
): BuiltRows {
  const types: { key: string; labelKey: string; type: PriceType }[] = [
    { key: 'input', labelKey: 'Input', type: 'input' },
    { key: 'output', labelKey: 'Output', type: 'output' },
  ]

  if (model.cache_ratio != null && options.includeCache !== false) {
    types.push({ key: 'cache', labelKey: 'Cached', type: 'cache' })
  }

  const officialModel = toOfficiallyPricedModel(model)
  let hasOfficialPrice = false
  let inputDiscountRatio: number | null = null

  const rows = types.map((entry) => {
    const platformPrice = getTokenUnitPrice(
      model,
      entry.type,
      options.tokenUnit,
      options.showRechargePrice ?? false,
      options.priceRate ?? 1,
      options.usdExchangeRate ?? 1,
      ratio
    )
    // Group ratio 1 and no recharge rate: this is the vendor's price, and none of
    // this site's commercial terms apply to it.
    const officialPrice = officialModel
      ? getTokenUnitPrice(
          officialModel,
          entry.type,
          options.tokenUnit,
          false,
          1,
          1,
          1
        )
      : Number.NaN
    hasOfficialPrice = hasOfficialPrice || Number.isFinite(officialPrice)
    const discountRatio = calcDiscountRatio(platformPrice, officialPrice)
    if (entry.type === 'input') {
      inputDiscountRatio = discountRatio
    }
    return {
      key: entry.key,
      labelKey: entry.labelKey,
      platform: formatTokenUnitPrice(platformPrice),
      official: formatTokenUnitPrice(officialPrice),
      discountRatio,
    }
  })

  return { rows, hasOfficialPrice, inputDiscountRatio }
}

function buildDynamicRows(
  model: PricingModel,
  options: PriceComparisonOptions,
  ratio: number
): BuiltRows {
  const summaryOptions = {
    tokenUnit: options.tokenUnit,
    showRechargePrice: options.showRechargePrice ?? false,
    priceRate: options.priceRate ?? 1,
    usdExchangeRate: options.usdExchangeRate ?? 1,
  }
  const platformOptions = { ...summaryOptions, groupRatioMultiplier: ratio }
  const platform = getDynamicPricingSummary(model, platformOptions)

  if (!platform) {
    return { rows: [], hasOfficialPrice: false, inputDiscountRatio: null }
  }
  if (platform.isSpecialExpression) {
    return {
      rows: [],
      hasOfficialPrice: false,
      inputDiscountRatio: null,
      specialExpression: platform.rawExpression,
    }
  }

  // Tiered pricing comes from the expression, but the official price does not:
  // the sync stores flat vendor ratios, so input and output are the only rows
  // that have an official counterpart. `primaryEntries` carries exactly those
  // two fields.
  const officialModel = toOfficiallyPricedModel(model)
  const officialTypeByField: Record<string, PriceType> = {
    inputPrice: 'input',
    outputPrice: 'output',
  }
  let hasOfficialPrice = false
  let inputDiscountRatio: number | null = null

  const rows = platform.primaryEntries.map((entry) => {
    const officialType = officialTypeByField[entry.field]
    const officialPrice =
      officialModel && officialType
        ? getTokenUnitPrice(
            officialModel,
            officialType,
            options.tokenUnit,
            false,
            1,
            1,
            1
          )
        : Number.NaN
    hasOfficialPrice = hasOfficialPrice || Number.isFinite(officialPrice)
    const discountRatio = calcDiscountRatio(
      getDynamicUnitPrice(entry.value, platformOptions),
      officialPrice
    )
    if (officialType === 'input') {
      inputDiscountRatio = discountRatio
    }
    return {
      key: entry.field,
      labelKey: entry.shortLabel,
      platform: entry.formatted,
      official: formatTokenUnitPrice(officialPrice),
      discountRatio,
    }
  })

  return { rows, hasOfficialPrice, inputDiscountRatio }
}

function formatRequest(
  model: PricingModel,
  options: PriceComparisonOptions,
  ratio: number
): string {
  return formatFixedPrice(
    model,
    SYNTHETIC_GROUP,
    options.showRechargePrice ?? false,
    options.priceRate ?? 1,
    options.usdExchangeRate ?? 1,
    { [SYNTHETIC_GROUP]: ratio }
  )
}
