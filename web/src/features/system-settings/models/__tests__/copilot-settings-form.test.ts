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
  COPILOT_SETTINGS_DEFAULTS,
  buildCopilotFormDefaults,
  copilotChannelIdValue,
  copilotSettingsSchema,
} from '../copilot-settings-form'

const shippedDefaults = buildCopilotFormDefaults(COPILOT_SETTINGS_DEFAULTS)

function valuesWith(overrides: Record<string, unknown>) {
  return {
    copilot_setting: { ...shippedDefaults.copilot_setting, ...overrides },
  }
}

function issueFor(
  values: Record<string, unknown>,
  field: string
): string | undefined {
  const result = copilotSettingsSchema.safeParse(values)
  if (result.success) return undefined
  return result.error.issues.find((issue) => issue.path[1] === field)?.message
}

describe('ops copilot settings validation', () => {
  test('accepts the shipped defaults, which leave the copilot off and unconfigured', () => {
    expect(copilotSettingsSchema.safeParse(shippedDefaults).success).toBe(true)
  })

  test('rejects tool-call rounds below the lower bound', () => {
    expect(issueFor(valuesWith({ max_rounds: 0 }), 'max_rounds')).toBe(
      'Tool-call rounds must be between 1 and 20'
    )
  })

  test('rejects tool-call rounds above the upper bound', () => {
    expect(issueFor(valuesWith({ max_rounds: 21 }), 'max_rounds')).toBe(
      'Tool-call rounds must be between 1 and 20'
    )
  })

  test('accepts tool-call rounds at both bounds', () => {
    for (const maxRounds of [1, 20]) {
      expect(
        copilotSettingsSchema.safeParse(valuesWith({ max_rounds: maxRounds }))
          .success
      ).toBe(true)
    }
  })

  test('rejects a fractional number of tool-call rounds', () => {
    expect(issueFor(valuesWith({ max_rounds: 8.5 }), 'max_rounds')).toBe(
      'Tool-call rounds must be a whole number'
    )
  })

  // Enabled with no model is surfaced as invalid rather than saved: the backend
  // would answer "not configured" to every question, so the operator should
  // learn about it here instead of from a broken copilot.
  test('rejects enabling the copilot while no model is chosen', () => {
    expect(
      issueFor(valuesWith({ enabled: true, model: '' }), 'model')
    ).toBe('Pick a model before enabling the ops copilot')
  })

  test('rejects a whitespace-only model when the copilot is enabled', () => {
    expect(
      issueFor(valuesWith({ enabled: true, model: '   ' }), 'model')
    ).toBe('Pick a model before enabling the ops copilot')
  })

  test('accepts an empty model while the copilot stays off', () => {
    expect(
      copilotSettingsSchema.safeParse(
        valuesWith({ enabled: false, model: '' })
      ).success
    ).toBe(true)
  })

  test('accepts an enabled copilot once a model is chosen', () => {
    const result = copilotSettingsSchema.safeParse(
      valuesWith({ enabled: true, model: '  gpt-4o-mini  ' })
    )
    expect(result.success).toBe(true)
    expect(result.data?.copilot_setting.model).toBe('gpt-4o-mini')
  })

  test('accepts an empty pinned channel, which means normal routing', () => {
    expect(
      copilotSettingsSchema.safeParse(valuesWith({ channel_id: '' })).success
    ).toBe(true)
  })

  test('rejects channel ids that are not non-negative whole numbers', () => {
    for (const channelId of ['-1', '1.5', 'abc', '1e3']) {
      expect(issueFor(valuesWith({ channel_id: channelId }), 'channel_id')).toBe(
        'Enter a channel ID as a non-negative whole number, or leave it empty for automatic routing'
      )
    }
  })
})

describe('ops copilot form boundary conversions', () => {
  test('renders the stored no-pinning channel as an empty field', () => {
    expect(shippedDefaults.copilot_setting.channel_id).toBe('')
  })

  test('renders a stored channel id as text and converts it back to a number', () => {
    const defaults = buildCopilotFormDefaults({
      ...COPILOT_SETTINGS_DEFAULTS,
      'copilot_setting.channel_id': 42,
    })
    expect(defaults.copilot_setting.channel_id).toBe('42')
    expect(copilotChannelIdValue('42')).toBe(42)
  })

  test('converts an empty channel field back to the stored 0', () => {
    expect(copilotChannelIdValue('')).toBe(0)
    expect(copilotChannelIdValue('  ')).toBe(0)
  })

  test('clamps a stored round count that is outside the allowed range', () => {
    for (const [stored, expected] of [
      [0, 1],
      [99, 20],
    ] as const) {
      const defaults = buildCopilotFormDefaults({
        ...COPILOT_SETTINGS_DEFAULTS,
        'copilot_setting.max_rounds': stored,
      })
      expect(defaults.copilot_setting.max_rounds).toBe(expected)
      expect(copilotSettingsSchema.safeParse(defaults).success).toBe(true)
    }
  })
})
