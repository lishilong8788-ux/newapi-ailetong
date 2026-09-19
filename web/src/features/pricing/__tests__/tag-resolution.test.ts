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

import type { ResolveTagOptions } from '@/lib/model-tags'

import { FILTER_ALL, SORT_OPTIONS } from '../constants'
import {
  extractAllTags,
  filterAndSortModels,
  filterByTag,
} from '../lib/filters'
import type { PricingModel } from '../types'

// The catalog reads `models.tags`, one comma-separated string an operator typed
// by hand. These tests pin the contract that used to be broken: the catalog once
// split on `/[,;|\s]+/`, so a tag with a space in it became two, and matched by
// lowercased text, so `Hot` and `hot` were two different filters.

function buildModel(id: number, tags?: string): PricingModel {
  return {
    id,
    model_name: `model-${id}`,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    tags,
  }
}

describe('extractAllTags', () => {
  test('keeps a tag containing a space as one tag', () => {
    const tags = extractAllTags([buildModel(1, 'long context')])

    expect(tags).toEqual(['long-context'])
  })

  test('collapses spelling variants of one tag into a single entry', () => {
    const tags = extractAllTags([
      buildModel(1, 'Hot'),
      buildModel(2, 'hot'),
      buildModel(3, 'HOT'),
    ])

    expect(tags).toEqual(['hot'])
  })

  test('collapses a localized alias onto its canonical slug', () => {
    const tags = extractAllTags([buildModel(1, '热门'), buildModel(2, 'hot')])

    expect(tags).toEqual(['hot'])
  })

  test('keeps distinct tags apart and orders them deterministically', () => {
    const tags = extractAllTags([
      buildModel(1, 'vision,hot'),
      buildModel(2, 'reasoning'),
    ])

    expect(tags).toEqual(['hot', 'reasoning', 'vision'])
  })

  test('returns nothing for a catalog with no tags', () => {
    const tags = extractAllTags([buildModel(1), buildModel(2, '')])

    expect(tags).toEqual([])
  })

  test('drops separator-only fragments instead of emitting an empty tag', () => {
    const tags = extractAllTags([buildModel(1, 'hot, ,,vision')])

    expect(tags).toEqual(['hot', 'vision'])
  })
})

describe('filterByTag', () => {
  test('matches a differently-cased spelling of the filtered tag', () => {
    const models = [buildModel(1, 'Hot'), buildModel(2, 'vision')]

    const result = filterByTag(models, 'hot')

    expect(result.map((m) => m.id)).toEqual([1])
  })

  test('matches a space-separated tag against its hyphenated slug', () => {
    const models = [buildModel(1, 'long context'), buildModel(2, 'vision')]

    const result = filterByTag(models, 'long-context')

    expect(result.map((m) => m.id)).toEqual([1])
  })

  test('matches an alias of the filtered tag', () => {
    const models = [buildModel(1, '热门'), buildModel(2, 'vision')]

    const result = filterByTag(models, 'hot')

    expect(result.map((m) => m.id)).toEqual([1])
  })

  test('resolves an alias supplied as the filter value', () => {
    const models = [buildModel(1, 'hot'), buildModel(2, 'vision')]

    const result = filterByTag(models, 'popular')

    expect(result.map((m) => m.id)).toEqual([1])
  })

  test('does not match one tag against another that merely shares a prefix', () => {
    const models = [buildModel(1, 'long-context'), buildModel(2, 'long')]

    const result = filterByTag(models, 'long-context')

    expect(result.map((m) => m.id)).toEqual([1])
  })

  test('returns every model for the all-tags sentinel', () => {
    const models = [buildModel(1, 'hot'), buildModel(2)]

    const result = filterByTag(models, FILTER_ALL)

    expect(result.map((m) => m.id)).toEqual([1, 2])
  })

  test('excludes models with no tags at all', () => {
    const models = [buildModel(1, 'hot'), buildModel(2)]

    const result = filterByTag(models, 'hot')

    expect(result.map((m) => m.id)).toEqual([1])
  })
})

describe('tag filter round trip', () => {
  // The rail is populated from `extractAllTags` and its chip values are fed
  // straight back into `filterByTag`. If those two disagree on what a tag is,
  // the page offers a filter that returns nothing.
  const CATALOG = [
    buildModel(1, 'Hot,long context'),
    buildModel(2, 'hot, vision'),
    buildModel(3, '热门'),
    buildModel(4, 'Long Context,reasoning'),
    buildModel(5),
  ]

  test('every offered tag matches at least one model', () => {
    const offered = extractAllTags(CATALOG)

    expect(offered.length).toBeGreaterThan(0)
    for (const tag of offered) {
      expect(filterByTag(CATALOG, tag).map((m) => m.id)).not.toEqual([])
    }
  })

  test('the offered tags between them reach every tagged model', () => {
    const reached = new Set(
      extractAllTags(CATALOG).flatMap((tag) =>
        filterByTag(CATALOG, tag).map((model) => model.id)
      )
    )

    expect([...reached].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })

  test('groups all spellings of one tag under a single chip', () => {
    const result = filterByTag(CATALOG, 'hot')

    expect(result.map((m) => m.id)).toEqual([1, 2, 3])
  })

  test('groups a spaced spelling with a hyphenated one', () => {
    const result = filterByTag(CATALOG, 'long-context')

    expect(result.map((m) => m.id)).toEqual([1, 4])
  })
})

describe('tag filtering with an operator registry', () => {
  // Operators can add vocabulary at runtime via `/api/status`. Aliases defined
  // there have to fold the same way built-in ones do, on both sides of the trip.
  const REGISTRY: ResolveTagOptions = {
    registry: [
      { slug: 'flagship', color: 'purple', kind: 'promo', aliases: ['旗舰'] },
    ],
  }

  test('collapses a registry alias onto the operator slug', () => {
    const tags = extractAllTags(
      [buildModel(1, '旗舰'), buildModel(2, 'flagship')],
      REGISTRY
    )

    expect(tags).toEqual(['flagship'])
  })

  test('matches a registry alias against the operator slug', () => {
    const models = [buildModel(1, '旗舰'), buildModel(2, 'vision')]

    const result = filterByTag(models, 'flagship', REGISTRY)

    expect(result.map((m) => m.id)).toEqual([1])
  })
})

describe('filterAndSortModels tag facet', () => {
  test('applies the tag filter alongside the other facets', () => {
    const models = [
      buildModel(1, 'Hot'),
      buildModel(2, 'hot'),
      buildModel(3, 'vision'),
    ]
    models[1].vendor_name = 'Anthropic'

    const result = filterAndSortModels(models, {
      search: '',
      vendor: 'Anthropic',
      group: FILTER_ALL,
      quotaType: FILTER_ALL,
      endpointType: FILTER_ALL,
      tag: 'hot',
      sortBy: SORT_OPTIONS.NAME,
    })

    expect(result.map((m) => m.id)).toEqual([2])
  })
})
