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
// ============================================================================
// Money helpers
//
// Invoice amounts arrive as integer minor units (cents). All arithmetic here
// stays in integers and the decimal point is inserted as a string, so no
// floating-point rounding error can reach the displayed total.
// ============================================================================

export const DEFAULT_INVOICE_CURRENCY = 'CNY'

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  RMB: '¥',
  USD: '$',
}

/** Uppercase/trim a currency code, falling back to CNY when absent. */
export function normalizeCurrency(currency?: string | null): string {
  const normalized = (currency ?? '').trim().toUpperCase()
  return normalized || DEFAULT_INVOICE_CURRENCY
}

/** Prefix symbol for a currency code; unknown codes keep their code. */
export function getCurrencySymbol(currency?: string | null): string {
  const code = normalizeCurrency(currency)
  return CURRENCY_SYMBOLS[code] ?? `${code} `
}

/** Group an integer digit string in threes: 1234567 -> 1,234,567 */
function groupDigits(digits: string): string {
  let grouped = ''
  for (let index = 0; index < digits.length; index++) {
    const remaining = digits.length - index
    grouped += digits[index]
    if (remaining > 1 && remaining % 3 === 1) {
      grouped += ','
    }
  }
  return grouped
}

/**
 * Format integer minor units as a two-decimal amount string, without a
 * currency symbol. Uses integer division and string padding only.
 */
export function formatMinorUnits(minor: number): string {
  const safe = Number.isFinite(minor) ? Math.trunc(minor) : 0
  const absolute = Math.abs(safe)
  const whole = Math.trunc(absolute / 100)
  const fraction = absolute % 100
  const sign = safe < 0 ? '-' : ''
  return `${sign}${groupDigits(String(whole))}.${String(fraction).padStart(2, '0')}`
}

/** Format integer minor units with the currency symbol, e.g. ¥1,234.05 */
export function formatMinorAmount(
  minor: number,
  currency?: string | null
): string {
  return `${getCurrencySymbol(currency)}${formatMinorUnits(minor)}`
}

/** Sum integer minor units; non-finite entries are ignored. */
export function sumMinorUnits(amounts: number[]): number {
  return amounts.reduce(
    (total, amount) =>
      total + (Number.isFinite(amount) ? Math.trunc(amount) : 0),
    0
  )
}

export interface CurrencySelectionState {
  /** The single currency shared by all items, or null when empty/mixed */
  currency: string | null
  /** True when the items span more than one currency */
  mixed: boolean
}

/**
 * Resolve the currency of a selection. One invoice can only carry a single
 * currency, so a mixed selection has to be rejected before submitting.
 */
export function resolveSelectionCurrency(
  items: { currency: string }[]
): CurrencySelectionState {
  if (items.length === 0) {
    return { currency: null, mixed: false }
  }

  const first = normalizeCurrency(items[0].currency)
  const mixed = items.some((item) => normalizeCurrency(item.currency) !== first)

  return { currency: mixed ? null : first, mixed }
}
