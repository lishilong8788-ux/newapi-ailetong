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
import { useChannelPricing } from '@/features/pricing/hooks'

import { ChannelPicker } from './channel-picker'

export type ChannelBlockProps = {
  modelName: string
  channelId?: number
  canPin: boolean
  onChannelChange?: (channelId: number | undefined) => void
}

/**
 * Data wiring for {@link ChannelPicker}: the per-model channel list.
 *
 * No currency rates, because no row states a price. The rate for the selected
 * model is already under the composer and on the pricing page; a per-channel
 * figure here would be quoted at group ratio 1 while that one includes the group
 * multiplier, putting two different numbers for one model a step apart.
 *
 * Renders nothing at all on error, deliberately. `/api/pricing/channels` is a
 * display-only endpoint — the playground sends requests perfectly well without
 * it, since automatic routing is the server's default — so a failure here should
 * cost the sidebar a block rather than leave a broken panel wedged under the
 * model list. The hook does not retry for the same reason.
 *
 * Nothing renders without a model either: the query is disabled, so a header
 * counting zero channels would be reporting the absence of a request rather than
 * the absence of channels.
 */
export function ChannelBlock(props: ChannelBlockProps) {
  const { routes, autoRoute, isLoading, error } = useChannelPricing(
    props.modelName || undefined
  )

  if (error || !props.modelName) return null

  return (
    <ChannelPicker
      modelName={props.modelName}
      routes={routes}
      autoRoute={autoRoute}
      isLoading={isLoading}
      channelId={props.channelId}
      canPin={props.canPin}
      onChannelChange={props.onChannelChange}
    />
  )
}
