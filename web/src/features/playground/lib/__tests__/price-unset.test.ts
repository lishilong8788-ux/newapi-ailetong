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

import type { PricingModel } from '@/features/pricing/types'

import { buildModelCatalog } from '../catalog/model-catalog'

function pricing(
  name: string,
  extra: Partial<PricingModel> = {}
): PricingModel {
  return {
    model_name: name,
    quota_type: 0,
    model_ratio: 2,
    model_price: 0,
    completion_ratio: 1,
    owner_by: '',
    enable_groups: ['default'],
    supported_endpoint_types: [],
    ...extra,
  } as PricingModel
}

describe('buildModelCatalog / unpriced models', () => {
  it('drops models the backend marked as unpriced', () => {
    const result = buildModelCatalog(
      ['priced', 'unpriced'],
      [pricing('priced'), pricing('unpriced', { price_unset: true })]
    )

    expect(result.map((model) => model.value)).toEqual(['priced'])
  })

  // The 37.5 sentinel is a legitimate ratio when self-use mode is on, and the
  // backend sends `price_unset: false` in that case. Inferring from the number
  // instead of the flag would hide a model the relay serves happily.
  it('keeps a model whose ratio is 37.5 but is flagged as priced', () => {
    const result = buildModelCatalog(
      ['sentinel'],
      [pricing('sentinel', { model_ratio: 37.5 })]
    )

    expect(result.map((model) => model.value)).toEqual(['sentinel'])
  })

  // A failed `/api/pricing` request yields no entries at all. Those models must
  // survive as bare names, or a catalog outage empties the library.
  it('keeps models that have no catalog entry', () => {
    const result = buildModelCatalog(['orphan'], [])

    expect(result).toEqual([{ label: 'orphan', value: 'orphan' }])
  })

  it('returns an empty list when every model is unpriced', () => {
    const result = buildModelCatalog(
      ['a', 'b'],
      [pricing('a', { price_unset: true }), pricing('b', { price_unset: true })]
    )

    expect(result).toEqual([])
  })
})

describe('buildModelCatalog / unrouted modalities', () => {
  // Video is routed but not open: `/pg/video/generations` submits through the
  // task pipeline, so these models are listed and reachable. Whether a given
  // channel can serve them is a separate question — an aggregator cannot, for
  // want of a task adaptor — and that is what `available: false` still says.
  it('keeps video models, which now have a /pg route', () => {
    const result = buildModelCatalog(
      ['clip'],
      [pricing('clip', { supported_endpoint_types: ['openai-video'] })]
    )

    expect(result.map((model) => model.value)).toEqual(['clip'])
    expect(result[0].modality).toBe('video')
  })

  it('drops audio models, tagged rather than typed by endpoint', () => {
    const result = buildModelCatalog(
      ['voice'],
      [pricing('voice', { tags: 'audio' })]
    )

    expect(result).toEqual([])
  })

  // Image is the case the `routed` flag exists to separate: `available: false`
  // (client flow unverified) but the route is registered, so the model stays and
  // the card shows the "coming soon" badge.
  it('keeps image models even though the modality is not marked available', () => {
    const result = buildModelCatalog(
      ['painter'],
      [
        pricing('painter', {
          supported_endpoint_types: ['image-generation'],
        }),
      ]
    )

    expect(result.map((model) => model.value)).toEqual(['painter'])
  })

  it('keeps chat models', () => {
    const result = buildModelCatalog(
      ['talker'],
      [pricing('talker', { supported_endpoint_types: ['openai'] })]
    )

    expect(result.map((model) => model.value)).toEqual(['talker'])
  })
})
