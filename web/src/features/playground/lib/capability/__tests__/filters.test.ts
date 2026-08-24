import { describe, expect, it } from 'vitest'

import type { ModelOption } from '../../../types'
import {
  FILTER_ALL,
  INITIAL_FILTER_STATE,
  buildVendorOptions,
  countByModality,
  filterModels,
} from '../../model-library/filters'

const MODELS: ModelOption[] = [
  {
    label: 'claude-opus-5',
    value: 'claude-opus-5',
    modality: 'chat',
    description: '擅长代码与长文本推理',
    vendorId: 1,
    vendorName: 'Anthropic',
  },
  {
    label: 'gpt-image-2',
    value: 'gpt-image-2',
    modality: 'image',
    description: '高质量图像生成',
    vendorId: 2,
    vendorName: 'OpenAI',
  },
  {
    label: 'gpt-5',
    value: 'gpt-5',
    modality: 'chat',
    vendorId: 2,
    vendorName: 'OpenAI',
  },
  {
    label: 'legacy-model',
    value: 'legacy-model',
  },
]

describe('filterModels', () => {
  it('returns everything with the initial state', () => {
    expect(filterModels(MODELS, INITIAL_FILTER_STATE)).toHaveLength(4)
  })

  it('filters by modality', () => {
    const result = filterModels(MODELS, {
      ...INITIAL_FILTER_STATE,
      modality: 'chat',
    })
    expect(result.map((m) => m.value)).toEqual(['claude-opus-5', 'gpt-5'])
  })

  it('excludes models with no modality from a specific tab', () => {
    // A catalog-less model cannot claim to be a chat model.
    const result = filterModels(MODELS, {
      ...INITIAL_FILTER_STATE,
      modality: 'image',
    })
    expect(result.map((m) => m.value)).toEqual(['gpt-image-2'])
  })

  it('filters by vendor', () => {
    const result = filterModels(MODELS, {
      ...INITIAL_FILTER_STATE,
      vendor: '2',
    })
    expect(result.map((m) => m.value)).toEqual(['gpt-image-2', 'gpt-5'])
  })

  it('searches names and descriptions case-insensitively', () => {
    expect(
      filterModels(MODELS, { ...INITIAL_FILTER_STATE, search: 'OPUS' })
    ).toHaveLength(1)
    expect(
      filterModels(MODELS, { ...INITIAL_FILTER_STATE, search: '代码' })
    ).toHaveLength(1)
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(
      filterModels(MODELS, { ...INITIAL_FILTER_STATE, search: '  gpt  ' })
    ).toHaveLength(2)
  })

  it('combines all three filters', () => {
    const result = filterModels(MODELS, {
      modality: 'chat',
      vendor: '2',
      search: 'gpt',
    })
    expect(result.map((m) => m.value)).toEqual(['gpt-5'])
  })
})

describe('countByModality', () => {
  it('counts each tab independently of the active modality', () => {
    const counts = countByModality(MODELS, {
      ...INITIAL_FILTER_STATE,
      modality: 'image',
    })

    expect(counts[FILTER_ALL]).toBe(4)
    expect(counts.chat).toBe(2)
    expect(counts.image).toBe(1)
    expect(counts.video).toBe(0)
  })

  it('respects the vendor filter', () => {
    const counts = countByModality(MODELS, {
      ...INITIAL_FILTER_STATE,
      vendor: '2',
    })

    expect(counts[FILTER_ALL]).toBe(2)
    expect(counts.chat).toBe(1)
    expect(counts.image).toBe(1)
  })
})

describe('buildVendorOptions', () => {
  it('lists vendors with counts, most-used first', () => {
    const options = buildVendorOptions(MODELS, INITIAL_FILTER_STATE)

    expect(options[0]).toEqual({
      value: FILTER_ALL,
      label: '全部厂商',
      count: 4,
    })
    expect(options.slice(1).map((o) => [o.label, o.count])).toEqual([
      ['OpenAI', 2],
      ['Anthropic', 1],
    ])
  })

  it('counts against the active modality so numbers match reality', () => {
    const options = buildVendorOptions(MODELS, {
      ...INITIAL_FILTER_STATE,
      modality: 'chat',
    })

    expect(options.slice(1).map((o) => [o.label, o.count])).toEqual([
      ['Anthropic', 1],
      ['OpenAI', 1],
    ])
  })

  it('skips models with no vendor', () => {
    const options = buildVendorOptions(
      [{ label: 'x', value: 'x' }],
      INITIAL_FILTER_STATE
    )
    expect(options).toHaveLength(1)
  })
})
