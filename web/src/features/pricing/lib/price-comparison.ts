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
  isDynamicPricingModel,
} from './dynamic-price'
import { getDisplayGroupRatio } from './model-helpers'
import { formatFixedPrice, formatGroupPrice } from './price'

// ----------------------------------------------------------------------------
// Platform / list-price comparison
// ----------------------------------------------------------------------------
//
// The pricing card shows three numbers per price type: what the customer pays
// (platform price, group ratio applied), the undiscounted reference (list price
// at ratio 1.0), and the ratio itself rendered as a discount.
//
// There is no separate vendor-price column in the data model: `model_ratio` IS
// the list price basis, so the reference number is simply the same calculation
// with the group ratio forced to 1. Models whose best ratio is >= 1 have nothing
// to compare, and `hasDiscount` is false for them so callers can collapse the
// comparison columns instead of printing a meaningless "10折".

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
  /** Same price at ratio 1.0, i.e. before the group discount. */
  list: string
}

export type PriceComparison = {
  rows: PriceComparisonRow[]
  /** Effective group ratio the platform column was computed with. */
  ratio: number
  /** False when ratio >= 1, i.e. the list and discount columns carry no info. */
  hasDiscount: boolean
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
  const base = { ratio, hasDiscount, isPerRequest: false }

  if (isDynamicPricingModel(model)) {
    return { ...base, ...buildDynamicRows(model, options, ratio) }
  }

  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return {
      ...base,
      isPerRequest: true,
      rows: [
        {
          key: 'request',
          labelKey: 'Per request',
          platform: formatRequest(model, options, ratio),
          list: formatRequest(model, options, 1),
        },
      ],
    }
  }

  return { ...base, rows: buildTokenRows(model, options, ratio) }
}

function buildTokenRows(
  model: PricingModel,
  options: PriceComparisonOptions,
  ratio: number
): PriceComparisonRow[] {
  const types: { key: string; labelKey: string; type: PriceType }[] = [
    { key: 'input', labelKey: 'Input', type: 'input' },
    { key: 'output', labelKey: 'Output', type: 'output' },
  ]

  if (model.cache_ratio != null && options.includeCache !== false) {
    types.push({ key: 'cache', labelKey: 'Cached', type: 'cache' })
  }

  return types.map((entry) => ({
    key: entry.key,
    labelKey: entry.labelKey,
    platform: formatToken(model, entry.type, options, ratio),
    list: formatToken(model, entry.type, options, 1),
  }))
}

function buildDynamicRows(
  model: PricingModel,
  options: PriceComparisonOptions,
  ratio: number
): { rows: PriceComparisonRow[]; specialExpression?: string } {
  const summaryOptions = {
    tokenUnit: options.tokenUnit,
    showRechargePrice: options.showRechargePrice ?? false,
    priceRate: options.priceRate ?? 1,
    usdExchangeRate: options.usdExchangeRate ?? 1,
  }
  const platform = getDynamicPricingSummary(model, {
    ...summaryOptions,
    groupRatioMultiplier: ratio,
  })
  const list = getDynamicPricingSummary(model, {
    ...summaryOptions,
    groupRatioMultiplier: 1,
  })

  if (!platform) return { rows: [] }
  if (platform.isSpecialExpression) {
    return { rows: [], specialExpression: platform.rawExpression }
  }

  // `primaryEntries` is derived from the same tier list in both calls, so the
  // two arrays line up positionally; `field` is matched anyway to be safe.
  const listByField = new Map(
    (list?.primaryEntries ?? []).map((entry) => [entry.field, entry.formatted])
  )

  return {
    rows: platform.primaryEntries.map((entry) => ({
      key: entry.field,
      labelKey: entry.shortLabel,
      platform: entry.formatted,
      list: listByField.get(entry.field) ?? entry.formatted,
    })),
  }
}

function formatToken(
  model: PricingModel,
  type: PriceType,
  options: PriceComparisonOptions,
  ratio: number
): string {
  return formatGroupPrice(
    model,
    SYNTHETIC_GROUP,
    type,
    options.tokenUnit,
    options.showRechargePrice ?? false,
    options.priceRate ?? 1,
    options.usdExchangeRate ?? 1,
    { [SYNTHETIC_GROUP]: ratio }
  )
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
