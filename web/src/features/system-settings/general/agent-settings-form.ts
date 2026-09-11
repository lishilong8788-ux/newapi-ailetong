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
import * as z from 'zod'

const RATE_RANGE_MESSAGE = 'Commission rate must be between 0% and 100%'
const FEE_RATE_RANGE_MESSAGE = 'Withdrawal fee rate must be between 0% and 100%'

/**
 * Agent distribution form contract.
 *
 * Rates live here as PERCENTAGES (5 meaning 5%) because that is what the
 * operator types; storage uses fractions. Keep the conversion at the form
 * boundary via {@link percentToCommissionRate} so a "5" never reaches the
 * server as 500%.
 */
export const agentSettingsSchema = z
  .object({
    AgentEnabled: z.boolean(),
    AgentSubscriptionCommission: z.boolean(),
    AgentDefaultRate: z.coerce
      .number()
      .min(0, RATE_RANGE_MESSAGE)
      .max(100, RATE_RANGE_MESSAGE),
    AgentMaxRate: z.coerce
      .number()
      .min(0, RATE_RANGE_MESSAGE)
      .max(100, RATE_RANGE_MESSAGE),
    AgentFreezeDays: z.coerce
      .number()
      .int('Freeze window must be a whole number of days')
      .min(0, 'Freeze window must be 0 days or more'),
    AgentMinWithdrawal: z.coerce
      .number()
      .gt(0, 'Minimum withdrawal must be greater than 0'),
    AgentWithdrawalFeeRate: z.coerce
      .number()
      .min(0, FEE_RATE_RANGE_MESSAGE)
      .max(100, FEE_RATE_RANGE_MESSAGE),
    AgentBalanceNeedAudit: z.boolean(),
    AgentAutoApprove: z.boolean(),
  })
  .refine((values) => values.AgentDefaultRate <= values.AgentMaxRate, {
    message:
      'Default commission rate cannot exceed the maximum commission rate',
    path: ['AgentDefaultRate'],
  })

export type AgentSettingsFormValues = z.infer<typeof agentSettingsSchema>

/** Option keys whose form value is a percentage of a stored fraction. */
export const AGENT_RATE_KEYS: ReadonlySet<string> = new Set([
  'AgentDefaultRate',
  'AgentMaxRate',
  'AgentWithdrawalFeeRate',
])

/** Rounding keeps the round-trip exact for the two decimals the inputs allow. */
export function commissionRateToPercent(rate: number): number {
  return Math.round(rate * 10000) / 100
}

export function percentToCommissionRate(percent: number): number {
  return Math.round(percent * 100) / 10000
}

/**
 * Sort key for the option writes of one save.
 *
 * The server rejects a default rate above the *stored* ceiling, so raising both
 * rates together only succeeds when the ceiling is written first.
 */
export function agentOptionSaveOrder(key: string): number {
  return key === 'AgentMaxRate' ? 0 : 1
}
