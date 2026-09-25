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
import { describe, expect, it } from 'vitest'

import { formatCopilotChannel, resolveCopilotTarget } from '../lib/target'
import type { CopilotModelOption, CopilotStatus } from '../types'

const MODELS: CopilotModelOption[] = [
  {
    model: 'gpt-5',
    channels: [
      { channel_id: 9, name: 'openai', type: 1 },
      { channel_id: 11, name: 'azure', code: 'az1', type: 3 },
    ],
  },
  {
    model: 'claude-4',
    channels: [{ channel_id: 12, name: 'anthropic', type: 14 }],
  },
]

function status(overrides: Partial<CopilotStatus> = {}): CopilotStatus {
  return {
    enabled: true,
    configured: true,
    model: 'gpt-5',
    channel_id: 0,
    max_rounds: 8,
    can_configure: true,
    ...overrides,
  }
}

describe('resolveCopilotTarget', () => {
  it('reports automatic routing when no channel is pinned', () => {
    const target = resolveCopilotTarget(status(), MODELS)

    expect(target.model).toBe('gpt-5')
    expect(target.channel).toBeUndefined()
    expect(target.isPinUnservable).toBe(false)
  })

  it('names the pinned channel so the trigger is not a bare id', () => {
    const target = resolveCopilotTarget(status({ channel_id: 11 }), MODELS)

    expect(target.channel).toEqual({
      channel_id: 11,
      name: 'azure',
      code: 'az1',
      type: 3,
    })
    expect(target.isPinUnservable).toBe(false)
  })

  // The server keeps a pin whatever the model is, so this pair is reachable
  // through the settings page. It fails only at the next message, which is why the
  // picker has to be able to say so up front.
  it('flags a pin that the selected model cannot route', () => {
    const target = resolveCopilotTarget(status({ channel_id: 12 }), MODELS)

    expect(target.isPinUnservable).toBe(true)
    expect(target.channel?.name).toBe('anthropic')
  })

  it('keeps an unknown pinned channel visible as an id', () => {
    const target = resolveCopilotTarget(status({ channel_id: 404 }), MODELS)

    expect(target.channel).toEqual({ channel_id: 404, name: '', type: 0 })
  })

  // Nothing to contradict yet: claiming unservable here would put a warning on a
  // configuration that is very likely fine.
  it('does not flag a pin before the options have loaded', () => {
    const target = resolveCopilotTarget(status({ channel_id: 11 }), [])

    expect(target.isPinUnservable).toBe(false)
    expect(target.channel?.channel_id).toBe(11)
  })

  it('treats a model missing from the options as unverifiable rather than wrong', () => {
    const target = resolveCopilotTarget(
      status({ model: 'typed-by-hand', channel_id: 9 }),
      MODELS
    )

    expect(target.isPinUnservable).toBe(false)
  })

  it('survives a status that has not arrived', () => {
    const target = resolveCopilotTarget(undefined, MODELS)

    expect(target.model).toBe('')
    expect(target.channel).toBeUndefined()
  })
})

describe('formatCopilotChannel', () => {
  it('includes the line code when the channel publishes one', () => {
    expect(
      formatCopilotChannel({
        channel_id: 11,
        name: 'azure',
        code: 'az1',
        type: 3,
      })
    ).toBe('#11 azure · az1')
  })

  it('degrades to the parts that exist', () => {
    expect(
      formatCopilotChannel({ channel_id: 9, name: 'openai', type: 1 })
    ).toBe('#9 openai')
    expect(formatCopilotChannel({ channel_id: 7, name: '', type: 0 })).toBe(
      '#7'
    )
  })
})
