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
import { describe, expect, test } from 'vitest'

import {
  getAdjustFormSchema,
  getRateFormSchema,
  isReasonComplete,
  isVoucherComplete,
  toAdjustPayload,
  toRatePayload,
} from '../admin-forms'

/** Interpolating stand-in for `t`, so assertions read as the operator sees them. */
const t = ((key: string, vars?: Record<string, unknown>) => {
  if (!vars) return key
  return key.replaceAll(/\{\{(\w+)\}\}/g, (_match, name) => String(vars[name]))
}) as unknown as TFunction

function firstError(issues: { path: PropertyKey[]; message: string }[]) {
  return issues[0]?.message
}

describe('rate form schema', () => {
  test.each([
    ['5', true],
    ['0', true],
    ['100', true],
    ['12.5', true],
    ['150', false],
    ['-1', false],
    ['', false],
    ['abc', false],
  ])('accepts %s: %s', (ratePercent, expected) => {
    const result = getRateFormSchema(t).safeParse({
      ratePercent,
      followDefault: false,
      reason: 'a valid reason for the change',
    })
    expect(result.success).toBe(expected)
  })

  test('names the bound when the rate is above 100 percent', () => {
    const result = getRateFormSchema(t).safeParse({
      ratePercent: '150',
      followDefault: false,
      reason: 'a valid reason for the change',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(firstError(result.error.issues)).toBe(
      'Commission rate must be between 0% and 100%'
    )
  })

  test('skips the rate checks entirely when following the global default', () => {
    // The field is disabled and empty in that mode, so requiring it would make
    // the form unsubmittable.
    const result = getRateFormSchema(t).safeParse({
      ratePercent: '',
      followDefault: true,
      reason: 'return to the platform default',
    })
    expect(result.success).toBe(true)
  })

  test('requires a reason even when only clearing the override', () => {
    const result = getRateFormSchema(t).safeParse({
      ratePercent: '',
      followDefault: true,
      reason: 'no',
    })
    expect(result.success).toBe(false)
  })
})

describe('toRatePayload', () => {
  test.each([
    ['5', 0.05],
    ['7.5', 0.075],
    ['0', 0],
    ['100', 1],
    // Four decimals is what the column stores, so the persisted value is exactly
    // what the operator was shown.
    ['3.33', 0.0333],
  ])('converts %s percent to the fraction %s', (ratePercent, expected) => {
    expect(
      toRatePayload({ ratePercent, followDefault: false, reason: 'x' }).rate
    ).toBe(expected)
  })

  test('sends null, not zero, when following the global default', () => {
    // These are different business outcomes: null pays the platform rate, 0 pays
    // nothing at all.
    expect(
      toRatePayload({ ratePercent: '9', followDefault: true, reason: 'x' })
    ).toEqual({ rate: null })
  })
})

describe('adjustment form schema', () => {
  const valid = {
    agentUserId: '88',
    amount: '-120.5',
    reason: 'clawback for refunded order 70001',
  }

  test('accepts a negative adjustment, which is how a clawback is recorded', () => {
    expect(getAdjustFormSchema(t).safeParse(valid).success).toBe(true)
  })

  test.each([
    ['zero', '0', 'Amount cannot be zero'],
    [
      'above the ceiling',
      '1000001',
      'Amount must be between -1000000 and 1000000',
    ],
    [
      'below the floor',
      '-1000001',
      'Amount must be between -1000000 and 1000000',
    ],
  ])('rejects an amount that is %s', (_label, amount, message) => {
    const result = getAdjustFormSchema(t).safeParse({ ...valid, amount })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(firstError(result.error.issues)).toBe(message)
  })

  test.each([['0'], ['-3'], ['abc'], ['']])(
    'rejects the agent user id %s',
    (agentUserId) => {
      expect(
        getAdjustFormSchema(t).safeParse({ ...valid, agentUserId }).success
      ).toBe(false)
    }
  )

  test('rejects an adjustment with no usable reason', () => {
    expect(
      getAdjustFormSchema(t).safeParse({ ...valid, reason: '   ' }).success
    ).toBe(false)
  })
})

describe('toAdjustPayload', () => {
  test('rounds the amount to fen, the smallest payable unit', () => {
    expect(
      toAdjustPayload({
        agentUserId: '88',
        amount: '-120.567',
        reason: '  spacing  ',
      })
    ).toEqual({
      agent_user_id: 88,
      amount: -120.57,
      reason: 'spacing',
    })
  })
})

describe('submit gating helpers', () => {
  test.each([
    ['', false],
    ['no', false],
    ['    ', false],
    // Whitespace does not count towards the minimum, or padding would satisfy it.
    ['  ab  ', false],
    ['valid reason', true],
  ])('isReasonComplete(%s) is %s', (reason, expected) => {
    expect(isReasonComplete(reason)).toBe(expected)
  })

  test.each([
    ['', false],
    ['X', false],
    ['   ', false],
    ['ICBC20260908771', true],
  ])('isVoucherComplete(%s) is %s', (voucher, expected) => {
    expect(isVoucherComplete(voucher)).toBe(expected)
  })
})
