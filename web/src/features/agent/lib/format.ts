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
const RMB_SYMBOL = '¥'
const CENTS_PER_YUAN = 100

/**
 * Renders a commission amount.
 *
 * Commission is settled in RMB and arrives as a decimal — it is *not* quota, so
 * it must never go through `formatQuota`, which would reinterpret it against the
 * configured quota-per-unit rate and display a different number.
 *
 * Rounding happens on integer cents so a value like `20.115` cannot land on
 * `20.11` through a float artifact.
 */
export function formatAgentCurrency(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return `${RMB_SYMBOL}0.00`

  const cents = Math.round(Math.abs(amount) * CENTS_PER_YUAN)
  const yuan = Math.trunc(cents / CENTS_PER_YUAN)
  const remainder = cents % CENTS_PER_YUAN
  const sign = amount < 0 && cents > 0 ? '-' : ''
  const grouped = new Intl.NumberFormat('en-US').format(yuan)

  return `${sign}${RMB_SYMBOL}${grouped}.${String(remainder).padStart(2, '0')}`
}

/**
 * Renders a commission rate as a percentage. `null` means the profile follows
 * the platform default, which only the server knows, so it reads as unset.
 */
export function formatCommissionRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '-'
  return `${Number((rate * 100).toFixed(2))}%`
}

/**
 * Presents an already-masked bank account.
 *
 * The agent endpoint only ever returns the last four digits (design doc §13.3),
 * so this adds the leading dots for readability without pretending to mask
 * anything itself — masking is the server's job.
 */
export function formatMaskedBankAccount(
  account: string | null | undefined
): string {
  const trimmed = account?.trim()
  if (!trimmed) return '-'
  if (trimmed.includes('*') || trimmed.includes('•')) return trimmed
  return `•••• ${trimmed}`
}

export type WithdrawalBreakdown = {
  amount: number
  fee: number
  net: number
}

/**
 * Splits a withdrawal request into the fee and what actually lands.
 *
 * Computed on integer cents and rounded half-up, matching how the backend
 * settles decimals, so the preview does not disagree with the receipt by a
 * cent. A non-finite or negative amount collapses to zero rather than producing
 * a negative fee.
 */
export function computeWithdrawalBreakdown(
  amount: number,
  feeRate: number
): WithdrawalBreakdown {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { amount: 0, fee: 0, net: 0 }
  }

  const safeRate = Number.isFinite(feeRate) && feeRate > 0 ? feeRate : 0
  const amountCents = Math.round(amount * CENTS_PER_YUAN)
  const feeCents = Math.min(
    amountCents,
    Math.round(amountCents * Math.min(safeRate, 1))
  )

  return {
    amount: amountCents / CENTS_PER_YUAN,
    fee: feeCents / CENTS_PER_YUAN,
    net: (amountCents - feeCents) / CENTS_PER_YUAN,
  }
}
