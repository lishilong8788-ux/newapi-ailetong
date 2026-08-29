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
const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  RMB: '¥',
  USD: '$',
}

const MINOR_UNITS_PER_MAJOR = 100

/**
 * Renders an amount held in the minor currency unit (cents).
 *
 * Finance transcribes these numbers into the invoicing platform, so the split
 * is done with integer arithmetic — dividing by 100 in floating point can turn
 * 1999 cents into 19.989999999999998 and lose the operator's trust.
 */
export function formatInvoiceAmount(
  amountInCents: number,
  currency?: string
): string {
  const cents = Number.isFinite(amountInCents) ? Math.trunc(amountInCents) : 0
  const isNegative = cents < 0
  const absolute = Math.abs(cents)
  const major = Math.trunc(absolute / MINOR_UNITS_PER_MAJOR)
  const minor = absolute % MINOR_UNITS_PER_MAJOR
  const digits = `${major}.${String(minor).padStart(2, '0')}`
  const code = (currency || 'CNY').toUpperCase()
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `
  return `${isNegative ? '-' : ''}${symbol}${digits}`
}

/** Splits the comma-separated trade-number snapshot into displayable entries. */
export function parseTradeNumbers(snapshot: string | undefined): string[] {
  if (!snapshot) return []
  return snapshot
    .split(',')
    .map((tradeNo) => tradeNo.trim())
    .filter((tradeNo) => tradeNo.length > 0)
}
