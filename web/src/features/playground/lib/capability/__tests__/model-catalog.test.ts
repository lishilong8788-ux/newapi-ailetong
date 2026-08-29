import { describe, expect, it } from 'vitest'

import type { PricingModel, PricingVendor } from '@/features/pricing/types'

import { buildModelCatalog } from '../../catalog/model-catalog'
import { deriveModality } from '../derive'

function pricingModel(overrides: Partial<PricingModel>): PricingModel {
  return {
    id: 1,
    model_name: 'model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    ...overrides,
  }
}

const VENDORS: PricingVendor[] = [
  { id: 7, name: 'OpenAI', icon: 'openai-icon' },
]

describe('buildModelCatalog', () => {
  it('falls back to the vendor mark when a model has no icon', () => {
    // Most catalogue entries carry no icon of their own, so without this the
    // list degrades to a column of grey letter placeholders.
    const [result] = buildModelCatalog(
      ['claude-haiku-4-5'],
      [pricingModel({ model_name: 'claude-haiku-4-5', vendor_id: 7 })],
      VENDORS
    )

    expect(result.icon).toBe('openai-icon')
  })

  it('prefers a model-specific icon over the vendor mark', () => {
    const [result] = buildModelCatalog(
      ['gpt-5'],
      [pricingModel({ model_name: 'gpt-5', icon: 'own-icon', vendor_id: 7 })],
      VENDORS
    )

    expect(result.icon).toBe('own-icon')
  })

  it('enriches allowed models with catalog metadata', () => {
    const [result] = buildModelCatalog(
      ['gpt-5'],
      [
        pricingModel({
          model_name: 'gpt-5',
          description: 'Flagship model',
          icon: 'gpt-icon',
          vendor_id: 7,
          tags: 'hot, new',
          supported_endpoint_types: ['openai'],
        }),
      ],
      VENDORS
    )

    expect(result).toMatchObject({
      value: 'gpt-5',
      modality: 'chat',
      description: 'Flagship model',
      icon: 'gpt-icon',
      tags: ['hot', 'new'],
      vendorId: 7,
      vendorName: 'OpenAI',
      vendorIcon: 'openai-icon',
    })
  })

  it('keeps models the catalog does not know about', () => {
    // The permission endpoint is authoritative; hiding an entitled model would
    // be worse than rendering a bare name.
    expect(buildModelCatalog(['custom-model'], [], VENDORS)).toEqual([
      { label: 'custom-model', value: 'custom-model' },
    ])
  })

  it('never invents models the user cannot call', () => {
    const result = buildModelCatalog(
      ['gpt-5'],
      [
        pricingModel({ model_name: 'gpt-5' }),
        pricingModel({ id: 2, model_name: 'secret-internal-model' }),
      ],
      VENDORS
    )

    expect(result).toHaveLength(1)
    expect(result[0].value).toBe('gpt-5')
  })

  it('preserves the order of the permission list', () => {
    const names = ['c-model', 'a-model', 'b-model']
    expect(buildModelCatalog(names, [], []).map((m) => m.value)).toEqual(names)
  })

  it('prefers the canonical vendor list over denormalised fields', () => {
    const [result] = buildModelCatalog(
      ['gpt-5'],
      [
        pricingModel({
          model_name: 'gpt-5',
          vendor_id: 7,
          vendor_name: 'Stale Name',
        }),
      ],
      VENDORS
    )

    expect(result.vendorName).toBe('OpenAI')
  })

  it('falls back to denormalised vendor fields when the id is unknown', () => {
    const [result] = buildModelCatalog(
      ['gpt-5'],
      [
        pricingModel({
          model_name: 'gpt-5',
          vendor_id: 99,
          vendor_name: 'Fallback Vendor',
        }),
      ],
      VENDORS
    )

    expect(result.vendorName).toBe('Fallback Vendor')
  })

  it('derives modality from endpoint types and tags', () => {
    const models = [
      pricingModel({
        model_name: 'img',
        supported_endpoint_types: ['image-generation'],
      }),
      pricingModel({
        id: 2,
        model_name: 'tts',
        supported_endpoint_types: ['openai'],
        tags: 'audio',
      }),
    ]
    const result = buildModelCatalog(['img', 'tts'], models, [])

    // Only the image model survives: the audio tag is still derived correctly —
    // asserted directly against `deriveModality` below — but audio has no `/pg`
    // route, so the catalog drops it. See the `routed` flag in the registry.
    expect(result.map((model) => model.value)).toEqual(['img'])
    expect(result[0].modality).toBe('image')
    expect(deriveModality(['openai'], 'audio')).toBe('audio')
  })

  it('leaves modality undefined for non-interactive models', () => {
    const [result] = buildModelCatalog(
      ['embed'],
      [
        pricingModel({
          model_name: 'embed',
          supported_endpoint_types: ['embeddings'],
        }),
      ],
      []
    )

    expect(result.modality).toBeUndefined()
  })

  it('omits tags when the field is empty rather than storing []', () => {
    const [result] = buildModelCatalog(
      ['gpt-5'],
      [pricingModel({ model_name: 'gpt-5', tags: ' , ' })],
      []
    )

    expect(result.tags).toBeUndefined()
  })

  it('tolerates missing pricing and vendor arguments', () => {
    expect(buildModelCatalog(['a'])).toEqual([{ label: 'a', value: 'a' }])
  })
})
