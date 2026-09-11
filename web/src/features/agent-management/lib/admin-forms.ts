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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { AGENT_VALIDATION, ERROR_MESSAGES } from '../constants'
import type {
  AdjustCommissionPayload,
  RejectWithdrawalPayload,
  SetAgentRatePayload,
} from '../types'

// ============================================================================
// Reason (shared by reject / suspend / payout-failed)
// ============================================================================

export type ReasonFormValues = {
  reason: string
}

/**
 * Every irreversible admin action carries a reason, and every reason is audited.
 * A minimum length rather than a bare non-empty check: "no" tells the next
 * reviewer nothing, and these rows are the record of who decided what.
 */
export function getReasonFormSchema(t: TFunction) {
  return z.object({
    reason: z
      .string()
      .trim()
      .min(
        AGENT_VALIDATION.REASON_MIN_LENGTH,
        t(ERROR_MESSAGES.REASON_TOO_SHORT, {
          min: AGENT_VALIDATION.REASON_MIN_LENGTH,
        })
      )
      .max(
        AGENT_VALIDATION.REASON_MAX_LENGTH,
        t(ERROR_MESSAGES.REASON_TOO_LONG, {
          max: AGENT_VALIDATION.REASON_MAX_LENGTH,
        })
      ),
  })
}

export const REASON_FORM_DEFAULTS: ReasonFormValues = { reason: '' }

export function toReasonPayload(
  values: ReasonFormValues
): RejectWithdrawalPayload {
  return { reason: values.reason.trim() }
}

/** Whether a draft reason would pass the schema, for gating a submit button. */
export function isReasonComplete(reason: string): boolean {
  const trimmed = reason.trim()
  return (
    trimmed.length >= AGENT_VALIDATION.REASON_MIN_LENGTH &&
    trimmed.length <= AGENT_VALIDATION.REASON_MAX_LENGTH
  )
}

// ============================================================================
// Payout voucher
// ============================================================================

export type VoucherFormValues = {
  voucher: string
}

export function getVoucherFormSchema(t: TFunction) {
  return z.object({
    voucher: z
      .string()
      .trim()
      .min(
        AGENT_VALIDATION.VOUCHER_MIN_LENGTH,
        t(ERROR_MESSAGES.VOUCHER_REQUIRED)
      )
      .max(
        AGENT_VALIDATION.VOUCHER_MAX_LENGTH,
        t(ERROR_MESSAGES.VOUCHER_TOO_LONG, {
          max: AGENT_VALIDATION.VOUCHER_MAX_LENGTH,
        })
      ),
  })
}

export const VOUCHER_FORM_DEFAULTS: VoucherFormValues = { voucher: '' }

/** Whether a draft voucher would pass the schema, for gating a submit button. */
export function isVoucherComplete(voucher: string): boolean {
  const trimmed = voucher.trim()
  return (
    trimmed.length >= AGENT_VALIDATION.VOUCHER_MIN_LENGTH &&
    trimmed.length <= AGENT_VALIDATION.VOUCHER_MAX_LENGTH
  )
}

// ============================================================================
// Commission rate
// ============================================================================

export type RateFormValues = {
  /** Percent as typed by the operator (5 means 5%), or '' when following default. */
  ratePercent: string
  followDefault: boolean
  reason: string
}

/**
 * The operator types percent; the API takes a 0–1 fraction. Keeping the form in
 * percent avoids the classic 5 vs 0.05 slip, and the conversion happens once, in
 * `toRatePayload`.
 */
export function getRateFormSchema(t: TFunction) {
  return z
    .object({
      ratePercent: z.string().trim(),
      followDefault: z.boolean(),
      reason: z
        .string()
        .trim()
        .min(
          AGENT_VALIDATION.REASON_MIN_LENGTH,
          t(ERROR_MESSAGES.REASON_TOO_SHORT, {
            min: AGENT_VALIDATION.REASON_MIN_LENGTH,
          })
        )
        .max(
          AGENT_VALIDATION.REASON_MAX_LENGTH,
          t(ERROR_MESSAGES.REASON_TOO_LONG, {
            max: AGENT_VALIDATION.REASON_MAX_LENGTH,
          })
        ),
    })
    .superRefine((values, ctx) => {
      if (values.followDefault) return

      if (values.ratePercent.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['ratePercent'],
          message: t(ERROR_MESSAGES.RATE_REQUIRED),
        })
        return
      }

      const parsed = Number(values.ratePercent)
      const maxPercent = AGENT_VALIDATION.RATE_MAX * 100
      const minPercent = AGENT_VALIDATION.RATE_MIN * 100
      if (
        !Number.isFinite(parsed) ||
        parsed < minPercent ||
        parsed > maxPercent
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['ratePercent'],
          message: t(ERROR_MESSAGES.RATE_OUT_OF_RANGE, {
            min: `${minPercent}%`,
            max: `${maxPercent}%`,
          }),
        })
      }
    })
}

export const RATE_FORM_DEFAULTS: RateFormValues = {
  ratePercent: '',
  followDefault: false,
  reason: '',
}

export function toRatePayload(values: RateFormValues): SetAgentRatePayload {
  if (values.followDefault) return { rate: null }
  // Percent → fraction, rounded to the 4 decimals the column stores so the value
  // the operator sees is the value that gets persisted.
  const fraction = Number(values.ratePercent) / 100
  return { rate: Number(fraction.toFixed(4)) }
}

// ============================================================================
// Commission adjustment
// ============================================================================

export type AdjustFormValues = {
  agentUserId: string
  amount: string
  reason: string
}

/**
 * Manual adjustments are the ledger's escape hatch, so both directions are
 * allowed but neither is unbounded: a negative row is a clawback, a positive row
 * is a payout the platform owes, and an unchecked magnitude on either side is a
 * billing incident.
 */
export function getAdjustFormSchema(t: TFunction) {
  return z.object({
    agentUserId: z
      .string()
      .trim()
      .refine(
        (value) => Number.isInteger(Number(value)) && Number(value) > 0,
        t(ERROR_MESSAGES.AGENT_REQUIRED)
      ),
    amount: z
      .string()
      .trim()
      .min(1, t(ERROR_MESSAGES.AMOUNT_REQUIRED))
      .refine((value) => Number.isFinite(Number(value)), {
        message: t(ERROR_MESSAGES.AMOUNT_REQUIRED),
      })
      .refine((value) => Number(value) !== 0, {
        message: t(ERROR_MESSAGES.AMOUNT_NOT_ZERO),
      })
      .refine(
        (value) =>
          Math.abs(Number(value)) <= AGENT_VALIDATION.ADJUST_AMOUNT_MAX,
        {
          message: t(ERROR_MESSAGES.AMOUNT_OUT_OF_RANGE, {
            max: AGENT_VALIDATION.ADJUST_AMOUNT_MAX,
          }),
        }
      ),
    reason: z
      .string()
      .trim()
      .min(
        AGENT_VALIDATION.REASON_MIN_LENGTH,
        t(ERROR_MESSAGES.REASON_TOO_SHORT, {
          min: AGENT_VALIDATION.REASON_MIN_LENGTH,
        })
      )
      .max(
        AGENT_VALIDATION.REASON_MAX_LENGTH,
        t(ERROR_MESSAGES.REASON_TOO_LONG, {
          max: AGENT_VALIDATION.REASON_MAX_LENGTH,
        })
      ),
  })
}

export const ADJUST_FORM_DEFAULTS: AdjustFormValues = {
  agentUserId: '',
  amount: '',
  reason: '',
}

export function toAdjustPayload(
  values: AdjustFormValues
): AdjustCommissionPayload {
  return {
    agent_user_id: Number(values.agentUserId),
    // Two decimals: the ledger stores yuan, and a fractional fen is not payable.
    amount: Number(Number(values.amount).toFixed(2)),
    reason: values.reason.trim(),
  }
}
