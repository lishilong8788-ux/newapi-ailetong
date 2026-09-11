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
const VISIBLE_ACCOUNT_DIGITS = 4

/**
 * Renders an RMB commission amount.
 *
 * Commissions are yuan decimals from `decimal(18,4)` columns, **not** quota —
 * `formatQuota` would divide by the quota-per-unit rate and understate every
 * figure on the page. Always two decimal places so a column of amounts lines up,
 * and the sign leads the symbol so a reversal reads as `-¥12.00`.
 */
export function formatCommissionAmount(
  amount: number | null | undefined
): string {
  if (amount == null || !Number.isFinite(amount)) return '—'
  const isNegative = amount < 0
  const digits = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${isNegative ? '-' : ''}${RMB_SYMBOL}${digits}`
}

/**
 * Renders a stored rate (0–1) as a percentage.
 *
 * `null` is not zero: it means the agent has no override and follows the global
 * default. Callers must render that case with their own translated label, so it
 * comes back as `null` rather than a hardcoded dash.
 */
export function formatCommissionRate(rate: number | null | undefined) {
  if (rate == null || !Number.isFinite(rate)) return null
  const percent = rate * 100
  const digits = Number.isInteger(percent) ? 0 : 2
  return `${percent.toFixed(digits)}%`
}

/**
 * Masks a bank account down to its last four digits.
 *
 * Applied on the agent list and anywhere outside the withdrawal detail sheet.
 * The server already masks those surfaces, so this is idempotent by design: a
 * value that arrives pre-masked passes through unchanged instead of being
 * masked twice into `••••••••`.
 */
export function maskBankAccount(account: string | null | undefined): string {
  if (!account) return '—'
  const trimmed = account.trim()
  if (trimmed.length === 0) return '—'
  const digits = trimmed.replaceAll(/\D/g, '')
  if (digits.length === 0) return trimmed
  if (digits.length <= VISIBLE_ACCOUNT_DIGITS) return `••••${digits}`
  return `••••${digits.slice(-VISIBLE_ACCOUNT_DIGITS)}`
}

/** Formats a customer/agent identity as `name (#id)`, falling back to the id. */
export function formatAgentIdentity(
  username: string | null | undefined,
  userId: number
): string {
  const name = username?.trim()
  return name ? `${name} (#${userId})` : `#${userId}`
}

/** Renders a withdrawal id as a padded, monospace-friendly order number. */
export function formatWithdrawalNo(id: number): string {
  return `WD${String(id).padStart(6, '0')}`
}
