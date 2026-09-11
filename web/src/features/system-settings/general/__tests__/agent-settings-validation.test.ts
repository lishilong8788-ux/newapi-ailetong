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
import { describe, expect, test } from 'vitest'

import {
  agentOptionSaveOrder,
  agentSettingsSchema,
} from '../agent-settings-form'

/** Percentages, matching what the form holds while an operator edits it. */
const validValues = {
  AgentEnabled: true,
  AgentSubscriptionCommission: false,
  AgentDefaultRate: 5,
  AgentMaxRate: 30,
  AgentFreezeDays: 7,
  AgentMinWithdrawal: 100,
  AgentWithdrawalFeeRate: 0,
  AgentBalanceNeedAudit: false,
  AgentAutoApprove: false,
}

function issueFor(
  values: Record<string, unknown>,
  field: string
): string | undefined {
  const result = agentSettingsSchema.safeParse(values)
  if (result.success) return undefined
  return result.error.issues.find((issue) => issue.path[0] === field)?.message
}

describe('agent distribution settings validation', () => {
  test('accepts the shipped defaults', () => {
    expect(agentSettingsSchema.safeParse(validValues).success).toBe(true)
  })

  test('rejects a default rate above the configured ceiling', () => {
    expect(
      issueFor(
        { ...validValues, AgentDefaultRate: 40, AgentMaxRate: 30 },
        'AgentDefaultRate'
      )
    ).toBe('Default commission rate cannot exceed the maximum commission rate')
  })

  test('accepts a default rate equal to the ceiling', () => {
    expect(
      agentSettingsSchema.safeParse({
        ...validValues,
        AgentDefaultRate: 30,
        AgentMaxRate: 30,
      }).success
    ).toBe(true)
  })

  test('rejects rates outside 0 to 100 percent', () => {
    for (const field of ['AgentDefaultRate', 'AgentMaxRate'] as const) {
      expect(issueFor({ ...validValues, [field]: -1 }, field)).toBe(
        'Commission rate must be between 0% and 100%'
      )
      expect(issueFor({ ...validValues, [field]: 101 }, field)).toBe(
        'Commission rate must be between 0% and 100%'
      )
    }
  })

  test('rejects a withdrawal fee rate outside 0 to 100 percent', () => {
    for (const feeRate of [-0.5, 100.5]) {
      expect(
        issueFor(
          { ...validValues, AgentWithdrawalFeeRate: feeRate },
          'AgentWithdrawalFeeRate'
        )
      ).toBe('Withdrawal fee rate must be between 0% and 100%')
    }
  })

  test('rejects a negative freeze window but allows zero', () => {
    expect(
      issueFor({ ...validValues, AgentFreezeDays: -1 }, 'AgentFreezeDays')
    ).toBe('Freeze window must be 0 days or more')
    expect(
      agentSettingsSchema.safeParse({ ...validValues, AgentFreezeDays: 0 })
        .success
    ).toBe(true)
  })

  test('rejects a fractional freeze window', () => {
    expect(
      issueFor({ ...validValues, AgentFreezeDays: 1.5 }, 'AgentFreezeDays')
    ).toBe('Freeze window must be a whole number of days')
  })

  test('rejects a non-positive minimum withdrawal', () => {
    for (const minWithdrawal of [0, -10]) {
      expect(
        issueFor(
          { ...validValues, AgentMinWithdrawal: minWithdrawal },
          'AgentMinWithdrawal'
        )
      ).toBe('Minimum withdrawal must be greater than 0')
    }
  })
})

describe('agent option save order', () => {
  test('writes the ceiling before the default rate so raising both succeeds', () => {
    const written = ['AgentDefaultRate', 'AgentFreezeDays', 'AgentMaxRate']
      .sort((a, b) => agentOptionSaveOrder(a) - agentOptionSaveOrder(b))
      .indexOf('AgentMaxRate')

    expect(written).toBe(0)
  })
})
