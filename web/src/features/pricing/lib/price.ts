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
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatDiscount } from '@/lib/format'

import { QUOTA_TYPE_VALUES, TOKEN_UNIT_DIVISORS } from '../constants'
import type { PricingModel, TokenUnit, PriceType } from '../types'
import { getConfiguredGroupRatio, getDisplayGroupRatio } from './model-helpers'

// ----------------------------------------------------------------------------
// Price Calculation Utilities
// ----------------------------------------------------------------------------

/**
 * Render a group ratio for customer-facing surfaces. Below 1 it reads as a
 * discount; at or above 1 there is no discount to express, so the raw
 * multiplier is kept.
 */
export function formatGroupRatio(
  ratio: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  // `formatDiscount` owns the "is this even a discount" test, so the sidebar and
  // the badges can never disagree about where the boundary is.
  return formatDiscount(ratio, t) ?? `${ratio}x`
}

/**
 * Strip trailing zeros from formatted price string while preserving currency symbols
 */
export function stripTrailingZeros(formatted: string): string {
  // Match currency symbol at start, number, and potential 'k' suffix
  const match = formatted.match(/^([^\d-]*)([-\d,]+\.?\d*)(k?)$/)
  if (!match) return formatted

  const [, symbol, number, suffix] = match

  // Remove commas for processing
  const cleanNumber = number.replaceAll(',', '')

  // Convert to number and back to remove trailing zeros
  const parsed = Number.parseFloat(cleanNumber)
  if (Number.isNaN(parsed)) return formatted

  // Convert to string, which automatically removes trailing zeros
  let result = parsed.toString()

  // If the result is in scientific notation, format it properly
  if (result.includes('e')) {
    result = parsed.toFixed(20).replace(/\.?0+$/, '')
  }

  return `${symbol}${result}${suffix}`
}

/**
 * Calculate token price in USD.
 *
 * Returns NaN when the required ratio field is missing/null so callers can
 * skip rendering that price type.
 */
function calculateTokenPrice(
  model: PricingModel,
  type: PriceType,
  ratio: number
): number {
  const base = model.model_ratio * 2 * ratio

  switch (type) {
    case 'input':
      return base
    case 'output':
      return base * model.completion_ratio
    case 'cache':
      return hasRatio(model.cache_ratio)
        ? base * Number(model.cache_ratio)
        : Number.NaN
    case 'create_cache':
      return hasRatio(model.create_cache_ratio)
        ? base * Number(model.create_cache_ratio)
        : Number.NaN
    case 'image':
      return hasRatio(model.image_ratio)
        ? base * Number(model.image_ratio)
        : Number.NaN
    case 'audio_input':
      return hasRatio(model.audio_ratio)
        ? base * Number(model.audio_ratio)
        : Number.NaN
    case 'audio_output':
      return hasRatio(model.audio_ratio) &&
        hasRatio(model.audio_completion_ratio)
        ? base *
            Number(model.audio_ratio) *
            Number(model.audio_completion_ratio)
        : Number.NaN
  }
}

function hasRatio(value: number | null | undefined): boolean {
  return value !== undefined && value !== null && Number.isFinite(Number(value))
}

/**
 * Apply recharge rate to price
 *
 * priceRate represents how much users need to recharge (in the display currency)
 * to get 1 USD credit. usdExchangeRate is the real exchange rate.
 *
 * The returned value will be formatted by formatCurrencyFromUSD, which will
 * multiply by the display currency's exchange rate.
 *
 * Examples:
 *
 * 1. Display currency = USD:
 *    - Model: 1 USD
 *    - priceRate = 0.5 (recharge $0.5 to get $1 credit)
 *    - usdExchangeRate = 1
 *    - Return: 1 × 0.5 / 1 = 0.5
 *    - formatCurrencyFromUSD(0.5) → $0.5 ✓
 *
 * 2. Display currency = CNY:
 *    - Model: 1 USD
 *    - priceRate = 4 (recharge ¥4 to get $1 credit)
 *    - usdExchangeRate = 7 (real rate: 1 USD = ¥7)
 *    - Return: 1 × 4 / 7 = 0.571
 *    - formatCurrencyFromUSD(0.571) → 0.571 × 7 = ¥4 ✓
 *    - Normal price: ¥7, Recharge price: ¥4 (cheaper!)
 */
function applyRechargeRate(
  price: number,
  showWithRecharge: boolean,
  priceRate: number,
  usdExchangeRate: number
): number {
  if (!showWithRecharge) return price
  return (price * priceRate) / usdExchangeRate
}

/**
 * The number `formatGroupPrice` renders, before currency conversion: one token
 * unit's worth of this price type, in system USD.
 *
 * Exposed so the discount column can be computed from the same arithmetic the
 * price columns print. Deriving it separately is how a card ends up claiming a
 * discount its own two numbers do not support.
 *
 * NaN when the model has no ratio for this price type, which
 * `formatCurrencyFromUSD` renders as `-`.
 */
export function getTokenUnitPrice(
  model: PricingModel,
  type: PriceType,
  tokenUnit: TokenUnit,
  showWithRecharge: boolean,
  priceRate: number,
  usdExchangeRate: number,
  groupRatio: number
): number {
  const priceInUSD = applyRechargeRate(
    calculateTokenPrice(model, type, groupRatio),
    showWithRecharge,
    priceRate,
    usdExchangeRate
  )
  return priceInUSD / TOKEN_UNIT_DIVISORS[tokenUnit]
}

/**
 * Format token-based price for display
 */
export function formatPrice(
  model: PricingModel,
  type: PriceType,
  tokenUnit: TokenUnit,
  showWithRecharge = false,
  priceRate = 1,
  usdExchangeRate = 1,
  selectedGroup?: string
): string {
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  return formatTokenUnitPrice(
    getTokenUnitPrice(
      model,
      type,
      tokenUnit,
      showWithRecharge,
      priceRate,
      usdExchangeRate,
      getDisplayGroupRatio(model, selectedGroup)
    )
  )
}

/**
 * Format price for a specific group (token-based)
 */
export function formatGroupPrice(
  model: PricingModel,
  group: string,
  type: PriceType,
  tokenUnit: TokenUnit,
  showWithRecharge = false,
  priceRate = 1,
  usdExchangeRate = 1,
  groupRatio: Record<string, number>
): string {
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  return formatTokenUnitPrice(
    getTokenUnitPrice(
      model,
      type,
      tokenUnit,
      showWithRecharge,
      priceRate,
      usdExchangeRate,
      getConfiguredGroupRatio(groupRatio, group)
    )
  )
}

/**
 * Render a per-token-unit price the way every price column in the catalog does.
 * NaN and null come out as `-`.
 */
export function formatTokenUnitPrice(price: number): string {
  return formatCurrencyFromUSD(price, {
    digitsLarge: 4,
    digitsSmall: 6,
    abbreviate: false,
  })
}

/**
 * The same model priced at the vendor's published rates, or null when there is
 * no official price to compare against.
 *
 * Official ratios are stored in the same unit as the platform ones, so swapping
 * the three fields in lets the whole existing pipeline — output/cache
 * multipliers, token unit, currency — produce the official column with no second
 * implementation.
 *
 * A missing official completion or cache ratio becomes NaN rather than falling
 * back to 1 or to the platform value: the vendor published no rate for that row,
 * and NaN renders as `-`. A `1` there would silently assert "official output
 * costs the same as official input", and the platform value would price an
 * official row off our own multiplier.
 */
export function toOfficiallyPricedModel(
  model: PricingModel
): PricingModel | null {
  // Per-request billing has no official counterpart: the sync collects token
  // prices, and `model_price` is a number this site chose.
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) return null

  const officialModelRatio = model.official_model_ratio
  if (
    officialModelRatio == null ||
    !Number.isFinite(officialModelRatio) ||
    officialModelRatio <= 0
  ) {
    return null
  }

  return {
    ...model,
    model_ratio: officialModelRatio,
    completion_ratio: model.official_completion_ratio ?? Number.NaN,
    cache_ratio: model.official_cache_ratio ?? null,
    // Ratios the official sync does not carry: left unset so a row that has no
    // official rate reads as `-` instead of borrowing the platform multiplier.
    create_cache_ratio: null,
    image_ratio: null,
    audio_ratio: null,
    audio_completion_ratio: null,
  }
}

/**
 * Format fixed price for pay-per-request models (with specific group)
 */
export function formatFixedPrice(
  model: PricingModel,
  group: string,
  showWithRecharge = false,
  priceRate = 1,
  usdExchangeRate = 1,
  groupRatio: Record<string, number>
): string {
  if (model.quota_type !== QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const ratio = getConfiguredGroupRatio(groupRatio, group)
  let priceInUSD = (model.model_price || 0) * ratio

  priceInUSD = applyRechargeRate(
    priceInUSD,
    showWithRecharge,
    priceRate,
    usdExchangeRate
  )

  return formatCurrencyFromUSD(priceInUSD, {
    digitsLarge: 4,
    digitsSmall: 4,
    abbreviate: false,
  })
}

/**
 * Format fixed price for pay-per-request models (minimum price from all groups)
 */
export function formatRequestPrice(
  model: PricingModel,
  showWithRecharge = false,
  priceRate = 1,
  usdExchangeRate = 1,
  selectedGroup?: string
): string {
  if (model.quota_type !== QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const displayGroupRatio = getDisplayGroupRatio(model, selectedGroup)

  let priceInUSD = (model.model_price || 0) * displayGroupRatio

  priceInUSD = applyRechargeRate(
    priceInUSD,
    showWithRecharge,
    priceRate,
    usdExchangeRate
  )

  return formatCurrencyFromUSD(priceInUSD, {
    digitsLarge: 4,
    digitsSmall: 4,
    abbreviate: false,
  })
}
