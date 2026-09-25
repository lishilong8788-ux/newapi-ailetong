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

/** Tool-call rounds a single copilot question may spend. */
export const COPILOT_MIN_MAX_ROUNDS = 1
export const COPILOT_MAX_MAX_ROUNDS = 20
export const COPILOT_DEFAULT_MAX_ROUNDS = 8

const ROUNDS_INTEGER_MESSAGE = 'Tool-call rounds must be a whole number'
const ROUNDS_RANGE_MESSAGE = 'Tool-call rounds must be between 1 and 20'
const CHANNEL_ID_MESSAGE =
  'Enter a channel ID as a non-negative whole number, or leave it empty for automatic routing'
const MODEL_REQUIRED_MESSAGE = 'Pick a model before enabling the ops copilot'

/**
 * A channel id is held as text while the operator edits it: the selector offers
 * the real channels but also accepts a typed id, and clearing the box has to
 * mean "no pinning" rather than "NaN". Digits-only keeps the synthesized
 * ratio-sync presets (negative ids) and decimals out.
 */
const channelIdField = z.string().refine((value) => {
  const trimmed = value.trim()
  if (!trimmed) return true
  return /^\d+$/.test(trimmed)
}, CHANNEL_ID_MESSAGE)

/**
 * Ops copilot settings form contract.
 *
 * The schema is NESTED even though the option keys are flat and dotted
 * (`copilot_setting.enabled`). That is deliberate: react-hook-form reads a
 * dotted `name` as a path, so a flat `'copilot_setting.enabled'` schema key
 * leaves two parallel value trees and saves never see the operator's input
 * (same trap documented in `grok-settings-card.tsx`).
 *
 * Two conversions live at this form boundary, both in
 * {@link buildCopilotFormDefaults} / {@link copilotChannelIdValue}:
 * - `channel_id` is a number in storage (0 = no pinning) and text in the form.
 * - `max_rounds` is clamped on load, because the server clamps it too and the
 *   form should show the bound that will actually apply.
 */
export const copilotSettingsSchema = z
  .object({
    copilot_setting: z.object({
      enabled: z.boolean(),
      model: z.string().trim(),
      channel_id: channelIdField,
      max_rounds: z.coerce
        .number()
        .int(ROUNDS_INTEGER_MESSAGE)
        .min(COPILOT_MIN_MAX_ROUNDS, ROUNDS_RANGE_MESSAGE)
        .max(COPILOT_MAX_MAX_ROUNDS, ROUNDS_RANGE_MESSAGE),
    }),
  })
  // An enabled copilot with no model is not a working copilot: the backend
  // would report "not configured" on every question. Block it here so the
  // operator fixes it while the form is in front of them.
  .refine(
    (values) =>
      !values.copilot_setting.enabled || values.copilot_setting.model !== '',
    { message: MODEL_REQUIRED_MESSAGE, path: ['copilot_setting', 'model'] }
  )

export type CopilotSettingsFormValues = z.output<typeof copilotSettingsSchema>

/**
 * The four `copilot_setting.*` options as the settings page stores them. The
 * model and channel are operator-chosen on purpose: nothing here ships a
 * default model name, and channel 0 means "route like any other request".
 */
export type CopilotSettingsOptions = {
  'copilot_setting.enabled': boolean
  'copilot_setting.model': string
  'copilot_setting.channel_id': number
  'copilot_setting.max_rounds': number
}

export const COPILOT_SETTINGS_DEFAULTS: CopilotSettingsOptions = {
  'copilot_setting.enabled': false,
  'copilot_setting.model': '',
  'copilot_setting.channel_id': 0,
  'copilot_setting.max_rounds': COPILOT_DEFAULT_MAX_ROUNDS,
}

export function clampCopilotMaxRounds(value: number): number {
  if (!Number.isFinite(value)) return COPILOT_DEFAULT_MAX_ROUNDS
  const rounded = Math.round(value)
  if (rounded < COPILOT_MIN_MAX_ROUNDS) return COPILOT_MIN_MAX_ROUNDS
  if (rounded > COPILOT_MAX_MAX_ROUNDS) return COPILOT_MAX_MAX_ROUNDS
  return rounded
}

/** `0` is the stored "no pinning" value and shows as an empty field. */
export function buildCopilotFormDefaults(
  options: CopilotSettingsOptions
): CopilotSettingsFormValues {
  const channelId = options['copilot_setting.channel_id']
  return {
    copilot_setting: {
      enabled: options['copilot_setting.enabled'],
      model: (options['copilot_setting.model'] ?? '').trim(),
      channel_id: channelId > 0 ? String(channelId) : '',
      max_rounds: clampCopilotMaxRounds(options['copilot_setting.max_rounds']),
    },
  }
}

/** Inverse of the channel conversion above, for the save path. */
export function copilotChannelIdValue(field: string): number {
  const trimmed = field.trim()
  return trimmed ? Number(trimmed) : 0
}
