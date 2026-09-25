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

const RATE_RANGE_MESSAGE = 'Rate must be between 0% and 100%'
const CHAIN_MESSAGE =
  'Rates must satisfy: disable ≤ demote ≤ alert ≤ warn (loss floor lowest, watch line highest)'

/**
 * Cost & margin settings form contract.
 *
 * Rates live here as PERCENTAGES (20 meaning 20%) because that is what the
 * operator types; storage uses fractions. Keep the conversion at the form
 * boundary via {@link percentToRate} so a "20" never reaches the server as
 * 2000%.
 */
export const costSettingsSchema = z
  .object({
    'cost_setting.guard_enabled': z.boolean(),
    'cost_setting.warn_rate': z.coerce
      .number()
      .min(0, RATE_RANGE_MESSAGE)
      .max(100, RATE_RANGE_MESSAGE),
    'cost_setting.alert_rate': z.coerce
      .number()
      .min(0, RATE_RANGE_MESSAGE)
      .max(100, RATE_RANGE_MESSAGE),
    'cost_setting.demote_rate': z.coerce
      .number()
      .min(0, RATE_RANGE_MESSAGE)
      .max(100, RATE_RANGE_MESSAGE),
    'cost_setting.disable_rate': z.coerce
      .number()
      .min(0, RATE_RANGE_MESSAGE)
      .max(100, RATE_RANGE_MESSAGE),
    'cost_setting.window_minutes': z.coerce
      .number()
      .int('Window must be a whole number of minutes')
      .min(1, 'Window must be at least 1 minute'),
    'cost_setting.min_requests': z.coerce
      .number()
      .int('Sample floor must be a whole number')
      .min(1, 'Sample floor must be at least 1 request'),
    'cost_setting.max_unknown_rate': z.coerce
      .number()
      .min(0, RATE_RANGE_MESSAGE)
      .max(100, RATE_RANGE_MESSAGE),
    'cost_setting.cooldown_minutes': z.coerce
      .number()
      .int('Cooldown must be a whole number of minutes')
      .min(0, 'Cooldown must be 0 minutes or more'),
    'cost_setting.flush_interval_seconds': z.coerce
      .number()
      .int('Flush interval must be a whole number of seconds')
      .min(5, 'Flush interval must be at least 5 seconds'),
  })
  .refine(
    (v) =>
      v['cost_setting.disable_rate'] <= v['cost_setting.demote_rate'] &&
      v['cost_setting.demote_rate'] <= v['cost_setting.alert_rate'] &&
      v['cost_setting.alert_rate'] <= v['cost_setting.warn_rate'],
    { message: CHAIN_MESSAGE, path: ['cost_setting.warn_rate'] }
  )

export type CostSettingsFormValues = z.infer<typeof costSettingsSchema>

/** Option keys whose form value is a percentage of a stored fraction. */
export const COST_RATE_KEYS: ReadonlySet<string> = new Set([
  'cost_setting.warn_rate',
  'cost_setting.alert_rate',
  'cost_setting.demote_rate',
  'cost_setting.disable_rate',
  'cost_setting.max_unknown_rate',
])

/** Rounding keeps the round-trip exact for the two decimals the inputs allow. */
export function rateToPercent(rate: number): number {
  return Math.round(rate * 10000) / 100
}

export function percentToRate(percent: number): number {
  return Math.round(percent * 100) / 10000
}

/**
 * Sort key for the option writes of one save.
 *
 * The server validates each rate against the *stored* values of the others, so
 * shifting the whole chain only succeeds when writes go lowest-first: disable
 * before demote before alert before warn. Raising warn while an old higher
 * demote is stored would otherwise be rejected.
 */
const COST_SAVE_ORDER: Readonly<Record<string, number>> = {
  'cost_setting.disable_rate': 0,
  'cost_setting.demote_rate': 1,
  'cost_setting.alert_rate': 2,
  'cost_setting.warn_rate': 3,
}

export function costOptionSaveOrder(key: string): number {
  return COST_SAVE_ORDER[key] ?? 4
}
