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
import { CHANNEL_STATUS } from '@/features/channels/constants'
import { parseModelsList } from '@/features/channels/lib'
import type { Channel, ChannelCostSettings } from '@/features/channels/types'
import type { ChannelRoute } from '@/features/pricing/types'

import type { CatalogSupplyRow } from '../types'

/**
 * The name a channel actually requests for a client-facing model.
 *
 * `model_mapping` is `{client: upstream}`, so a channel that remaps buys under
 * a different name than it sells. Every cost lookup is keyed by the upstream
 * name (`resolveModelCostExact` reads it that way), which is why this resolution
 * has to happen before any price is read rather than being assumed away.
 *
 * Invalid JSON degrades to "no mapping" instead of throwing: a channel with a
 * broken mapping still serves the unmapped name, and a crash here would take the
 * whole supply table down with it.
 */
export function resolveUpstreamModel(
  channel: Pick<Channel, 'model_mapping'>,
  modelName: string
): string {
  const raw = channel.model_mapping?.trim()
  if (!raw) return modelName
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return modelName
    }
    const mapped = (parsed as Record<string, unknown>)[modelName]
    return typeof mapped === 'string' && mapped.trim() ? mapped : modelName
  } catch {
    return modelName
  }
}

/** The channel's stored buy-price config, or null when it has none. */
export function readChannelCostSettings(
  settingsStr: string | null | undefined
): ChannelCostSettings | null {
  if (!settingsStr || settingsStr === '{}') return null
  try {
    const parsed = JSON.parse(settingsStr)
    const cost = parsed?.cost
    if (!cost || typeof cost !== 'object' || Array.isArray(cost)) return null
    return cost as ChannelCostSettings
  } catch {
    return null
  }
}

/**
 * Every channel that lists this model, cheapest-serving first.
 *
 * Ordering puts serving lines above idle ones, then follows the order
 * `/api/pricing/channels` returned — which is already the routing order, so the
 * top row is the line a request would actually land on. Idle lines keep their
 * channel-id order; there is no price to rank them by.
 */
export function buildSupplyRows(
  modelName: string,
  channels: readonly Channel[],
  routes: readonly ChannelRoute[]
): CatalogSupplyRow[] {
  const routeByChannel = new Map(routes.map((route) => [route.channel_id, route]))
  const routeOrder = new Map(
    routes.map((route, index) => [route.channel_id, index])
  )

  const rows = channels
    .filter((channel) => parseModelsList(channel.models ?? '').includes(modelName))
    .map((channel) => {
      const route = routeByChannel.get(channel.id)
      return {
        channel,
        route,
        upstreamModel: resolveUpstreamModel(channel, modelName),
        serving: Boolean(route),
      } satisfies CatalogSupplyRow
    })

  return rows.sort((a, b) => {
    if (a.serving !== b.serving) return a.serving ? -1 : 1
    if (a.serving && b.serving) {
      return (
        (routeOrder.get(a.channel.id) ?? 0) - (routeOrder.get(b.channel.id) ?? 0)
      )
    }
    return a.channel.id - b.channel.id
  })
}

/** Channels that do not list this model yet — the pool the attach dialog offers. */
export function findAttachableChannels(
  modelName: string,
  channels: readonly Channel[]
): Channel[] {
  return channels.filter(
    (channel) => !parseModelsList(channel.models ?? '').includes(modelName)
  )
}

/**
 * The model list a channel should be saved with after adding or removing one
 * model, or null when the change is already in effect.
 *
 * Returns the comma-joined string the API stores, with the original order kept
 * and the new name appended: a channel's model list is read by humans, and
 * re-sorting it on an unrelated edit produces a diff nobody asked for. Null
 * rather than the unchanged string so callers can skip the request entirely.
 */
export function buildChannelModelList(
  channel: Pick<Channel, 'models'>,
  modelName: string,
  action: 'attach' | 'detach'
): string | null {
  const models = parseModelsList(channel.models ?? '')
  const has = models.includes(modelName)

  if (action === 'attach') {
    if (has) return null
    return [...models, modelName].join(',')
  }

  if (!has) return null
  return models.filter((model) => model !== modelName).join(',')
}

/** True when the channel is enabled, i.e. eligible to serve anything at all. */
export function isChannelEnabled(channel: Pick<Channel, 'status'>): boolean {
  return channel.status === CHANNEL_STATUS.ENABLED
}
