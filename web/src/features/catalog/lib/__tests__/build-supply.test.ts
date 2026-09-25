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

import type { Channel } from '@/features/channels/types'
import type { ChannelRoute } from '@/features/pricing/types'

import {
  buildChannelModelList,
  buildSupplyRows,
  findAttachableChannels,
  readChannelCostSettings,
  resolveUpstreamModel,
} from '../build-supply'

function makeChannel(overrides: Partial<Channel> & { id: number }): Channel {
  return {
    type: 1,
    key: '',
    status: 1,
    name: `channel-${overrides.id}`,
    created_time: 0,
    test_time: 0,
    response_time: 0,
    other: '',
    balance: 0,
    balance_updated_time: 0,
    models: '',
    group: 'default',
    used_quota: 0,
    other_info: '',
    remark: '',
    max_input_tokens: 0,
    channel_info: {
      is_multi_key: false,
      multi_key_size: 0,
      multi_key_polling_index: 0,
      multi_key_mode: 'random',
    },
    settings: '{}',
    ...overrides,
  } as Channel
}

function makeRoute(channelId: number): ChannelRoute {
  return {
    channel_id: channelId,
    category: 'vendor',
    price: { price_source: 'cost', model_ratio: 1 },
  }
}

describe('resolveUpstreamModel', () => {
  it('returns the client name when the channel has no mapping', () => {
    const channel = makeChannel({ id: 1, model_mapping: null })

    expect(resolveUpstreamModel(channel, 'gpt-4o')).toBe('gpt-4o')
  })

  it('returns the mapped upstream name when the model is remapped', () => {
    const channel = makeChannel({
      id: 1,
      model_mapping: '{"gpt-4o":"vendor-gpt-4o"}',
    })

    expect(resolveUpstreamModel(channel, 'gpt-4o')).toBe('vendor-gpt-4o')
  })

  it('falls back to the client name when the mapping JSON is invalid', () => {
    const channel = makeChannel({ id: 1, model_mapping: '{broken' })

    expect(resolveUpstreamModel(channel, 'gpt-4o')).toBe('gpt-4o')
  })

  it('ignores a mapping entry that is not a non-empty string', () => {
    const channel = makeChannel({
      id: 1,
      model_mapping: '{"gpt-4o":"   "}',
    })

    expect(resolveUpstreamModel(channel, 'gpt-4o')).toBe('gpt-4o')
  })
})

describe('readChannelCostSettings', () => {
  it('returns the cost object stored under settings.cost', () => {
    const settings = JSON.stringify({
      cost: { default_markup: 0.3, models: { 'gpt-4o': { input: 2.5 } } },
    })

    expect(readChannelCostSettings(settings)).toEqual({
      default_markup: 0.3,
      models: { 'gpt-4o': { input: 2.5 } },
    })
  })

  it('returns null for an empty settings blob', () => {
    expect(readChannelCostSettings('{}')).toBeNull()
    expect(readChannelCostSettings(null)).toBeNull()
  })

  it('returns null when cost is not an object', () => {
    expect(readChannelCostSettings(JSON.stringify({ cost: [1, 2] }))).toBeNull()
  })
})

describe('buildSupplyRows', () => {
  it('includes a channel that lists the model but has no live route', () => {
    const channels = [makeChannel({ id: 7, models: 'gpt-4o', status: 0 })]

    const rows = buildSupplyRows('gpt-4o', channels, [])

    expect(rows).toHaveLength(1)
    expect(rows[0].serving).toBe(false)
    expect(rows[0].route).toBeUndefined()
  })

  it('excludes channels whose model list does not contain the model', () => {
    const channels = [
      makeChannel({ id: 1, models: 'gpt-4o' }),
      makeChannel({ id: 2, models: 'claude-3-5-sonnet' }),
    ]

    const rows = buildSupplyRows('gpt-4o', channels, [])

    expect(rows.map((row) => row.channel.id)).toEqual([1])
  })

  it('sorts serving lines ahead of idle ones and keeps the routing order', () => {
    const channels = [
      makeChannel({ id: 1, models: 'gpt-4o' }),
      makeChannel({ id: 2, models: 'gpt-4o' }),
      makeChannel({ id: 3, models: 'gpt-4o' }),
    ]
    // The endpoint returns channel 3 before channel 1, which is the order a
    // request would try them in.
    const routes = [makeRoute(3), makeRoute(1)]

    const rows = buildSupplyRows('gpt-4o', channels, routes)

    expect(rows.map((row) => row.channel.id)).toEqual([3, 1, 2])
  })

  it('resolves the upstream name per row', () => {
    const channels = [
      makeChannel({
        id: 1,
        models: 'gpt-4o',
        model_mapping: '{"gpt-4o":"azure-gpt-4o"}',
      }),
    ]

    const rows = buildSupplyRows('gpt-4o', channels, [])

    expect(rows[0].upstreamModel).toBe('azure-gpt-4o')
  })
})

describe('findAttachableChannels', () => {
  it('returns only channels that do not already list the model', () => {
    const channels = [
      makeChannel({ id: 1, models: 'gpt-4o,gpt-4o-mini' }),
      makeChannel({ id: 2, models: 'claude-3-5-sonnet' }),
    ]

    const attachable = findAttachableChannels('gpt-4o', channels)

    expect(attachable.map((channel) => channel.id)).toEqual([2])
  })
})

describe('buildChannelModelList', () => {
  it('appends the model without reordering the existing list', () => {
    const channel = makeChannel({ id: 1, models: 'b-model,a-model' })

    expect(buildChannelModelList(channel, 'c-model', 'attach')).toBe(
      'b-model,a-model,c-model'
    )
  })

  it('returns null when attaching a model the channel already lists', () => {
    const channel = makeChannel({ id: 1, models: 'gpt-4o' })

    expect(buildChannelModelList(channel, 'gpt-4o', 'attach')).toBeNull()
  })

  it('removes only the named model when detaching', () => {
    const channel = makeChannel({ id: 1, models: 'gpt-4o,gpt-4o-mini' })

    expect(buildChannelModelList(channel, 'gpt-4o', 'detach')).toBe(
      'gpt-4o-mini'
    )
  })

  it('returns an empty string when detaching the channel last model', () => {
    const channel = makeChannel({ id: 1, models: 'gpt-4o' })

    expect(buildChannelModelList(channel, 'gpt-4o', 'detach')).toBe('')
  })

  it('returns null when detaching a model the channel does not list', () => {
    const channel = makeChannel({ id: 1, models: 'gpt-4o' })

    expect(buildChannelModelList(channel, 'claude-3-5-sonnet', 'detach')).toBeNull()
  })
})
