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
import { COPILOT_AUTO_CHANNEL_ID } from '../constants'
import type {
  CopilotChannelChoice,
  CopilotModelOption,
  CopilotStatus,
} from '../types'

/** What the composer's picker trigger has to say about the current selection. */
export interface CopilotTarget {
  /** Empty when no model is configured — the picker then reads as an invitation. */
  model: string
  /** `undefined` means automatic routing rather than a pinned line. */
  channel?: CopilotChannelChoice
  /**
   * A pin is kept whatever the model is: the server does not require the pinned
   * channel to serve the selected model, because an operator pinning a line knows
   * something the ability table may not yet. But a pair that cannot route is worth
   * saying out loud — silently pinned-and-unservable fails only at the next
   * message, and the error then blames the copilot rather than this selection.
   */
  isPinUnservable: boolean
}

export function findCopilotModelOption(
  models: CopilotModelOption[],
  modelName: string
): CopilotModelOption | undefined {
  if (!modelName) return undefined
  return models.find((option) => option.model === modelName)
}

/**
 * Resolves the configured selection against the offered options.
 *
 * The pinned channel is looked up across every model rather than only within the
 * selected one, so a pin that does not serve the model still renders with its
 * name instead of collapsing to a bare id the reader has to go look up.
 */
export function resolveCopilotTarget(
  status: CopilotStatus | undefined,
  models: CopilotModelOption[]
): CopilotTarget {
  const model = status?.model ?? ''
  const channelId = status?.channel_id ?? COPILOT_AUTO_CHANNEL_ID
  if (channelId === COPILOT_AUTO_CHANNEL_ID) {
    return { model, isPinUnservable: false }
  }

  const selected = findCopilotModelOption(models, model)
  const servesModel = (selected?.channels ?? []).some(
    (channel) => channel.channel_id === channelId
  )
  const known = models
    .flatMap((option) => option.channels)
    .find((channel) => channel.channel_id === channelId)

  return {
    model,
    // Falls back to an id-only entry: the pin is configured, so it must be shown
    // even when nothing in the offered set describes it.
    channel: known ?? { channel_id: channelId, name: '', type: 0 },
    // Only claimed when the model's own channel list is known. With no list yet
    // (still loading, or a model typed into the settings page) there is nothing to
    // contradict, and guessing would put a warning on a working configuration.
    isPinUnservable: Boolean(selected) && !servesModel,
  }
}

/** `#7 azure · az1`, degrading to the parts that exist. */
export function formatCopilotChannel(channel: CopilotChannelChoice): string {
  const parts = [`#${channel.channel_id}`]
  if (channel.name) parts.push(channel.name)
  const label = parts.join(' ')
  return channel.code ? `${label} · ${channel.code}` : label
}
