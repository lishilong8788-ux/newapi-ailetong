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
import type { Model } from '@/features/models/types'
import type { PricingModel } from '@/features/pricing/types'

import { buildCatalog } from '../build-catalog'

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

function makeModelRow(overrides: Partial<Model> & { model_name: string }): Model {
  return {
    id: 1,
    status: 1,
    sync_official: 1,
    created_time: 0,
    updated_time: 0,
    name_rule: 0,
    ...overrides,
  } as Model
}

function makePricing(modelName: string): PricingModel {
  return {
    id: 0,
    model_name: modelName,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
  } as PricingModel
}

describe('buildCatalog', () => {
  it('attaches the metadata row so the entry can be edited by id', () => {
    const rows = [makeModelRow({ id: 42, model_name: 'gpt-4o' })]

    const items = buildCatalog([makePricing('gpt-4o')], [], rows)

    expect(items[0].model?.id).toBe(42)
  })

  it('lists a model whose metadata row exists but is in neither other source', () => {
    // A disabled row reaches no channel and no pricing payload, and it is exactly
    // the row an operator has to find in order to re-enable it.
    const rows = [makeModelRow({ id: 9, model_name: 'retired-model', status: 0 })]

    const items = buildCatalog([], [], rows)

    expect(items.map((item) => item.modelName)).toEqual(['retired-model'])
    expect(items[0].status).toBe('out_of_stock')
  })

  it('names the vendor from the metadata row when pricing carries none', () => {
    const rows = [
      makeModelRow({ id: 1, model_name: 'house-model', vendor_id: 3 }),
    ]
    const vendors = [{ id: 3, name: 'House', icon: 'openai' }]

    const items = buildCatalog([], [], rows, vendors)

    expect(items[0].vendorName).toBe('House')
    expect(items[0].vendorIcon).toBe('openai')
  })

  it('leaves the entry without a model row when only a channel names it', () => {
    const channels = [makeChannel({ id: 1, models: 'relay-only' })]

    const items = buildCatalog([], channels, [])

    expect(items[0].model).toBeUndefined()
    expect(items[0].channelCount).toBe(1)
  })
})
