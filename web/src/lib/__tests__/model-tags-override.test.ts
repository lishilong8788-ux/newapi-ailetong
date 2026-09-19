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

import { BUILTIN_TAGS, resolveTag, type TagDefinition } from '../model-tags'

// A registry entry is an overlay on the built-in of the same slug, not a
// replacement. These tests pin the two failures that a replacement produced,
// because both render as what looks like corrupted data to an operator: one tag
// painting two colours, and a translated tag reverting to raw stored text.

/** Stand-in translator: returns the key, so "did it translate" is observable. */
const translate = (key: string) => `T:${key}`

describe('registry override inherits from the built-in', () => {
  test('a colour-only override still resolves the built-in aliases', () => {
    const registry: TagDefinition[] = [{ slug: 'hot', color: 'purple' }]

    // Both spellings are the same logical tag. Before the merge, only the
    // literal slug picked up the override and 热门 kept the built-in red.
    const bySlug = resolveTag('hot', { registry, t: translate })
    const byAlias = resolveTag('热门', { registry, t: translate })

    expect(bySlug.variant).toBe('purple')
    expect(byAlias.variant).toBe('purple')
    expect(byAlias.slug).toBe(bySlug.slug)
  })

  test('a colour-only override keeps the built-in translated label', () => {
    const registry: TagDefinition[] = [{ slug: 'deprecated', color: 'orange' }]

    const resolved = resolveTag('deprecated', { registry, t: translate })

    // Not the raw text "deprecated": the built-in labelKey must still be used.
    expect(resolved.label).toBe('T:Deprecated')
    expect(resolved.variant).toBe('orange')
  })

  test('an explicit operator label wins over the built-in key', () => {
    const registry: TagDefinition[] = [
      { slug: 'hot', color: 'red', labels: { en: 'Trending', zhCN: '正热' } },
    ]

    expect(resolveTag('hot', { registry, t: translate, language: 'en' }).label).toBe(
      'Trending'
    )
    expect(
      resolveTag('热门', { registry, t: translate, language: 'zhCN' }).label
    ).toBe('正热')
  })

  test('an override inherits kind when it omits one', () => {
    const registry: TagDefinition[] = [{ slug: 'beta', color: 'info' }]

    // `beta` is lifecycle in the vocabulary. Defaulting to 'capability' here
    // would quietly change card ordering, since promo-ness drives the sort.
    expect(resolveTag('beta', { registry, t: translate }).kind).toBe('lifecycle')
  })

  test('operator aliases add to the inherited ones rather than replacing them', () => {
    const registry: TagDefinition[] = [
      { slug: 'hot', color: 'pink', aliases: ['爆款'] },
    ]

    for (const spelling of ['hot', '热门', 'popular', '爆款']) {
      expect(resolveTag(spelling, { registry, t: translate }).variant).toBe('pink')
    }
  })

  test('a brand-new tag with no built-in counterpart still resolves', () => {
    const registry: TagDefinition[] = [
      { slug: 'flagship', color: 'indigo', kind: 'promo', labels: { en: 'Flagship' } },
    ]

    const resolved = resolveTag('Flagship', { registry, t: translate })
    expect(resolved.known).toBe(true)
    expect(resolved.variant).toBe('indigo')
    expect(resolved.kind).toBe('promo')
    expect(resolved.label).toBe('Flagship')
  })

  test('every built-in alias resolves to its own slug with no registry', () => {
    for (const builtin of BUILTIN_TAGS) {
      for (const alias of builtin.aliases) {
        const resolved = resolveTag(alias, { t: translate })
        expect(resolved.slug).toBe(builtin.slug)
        expect(resolved.variant).toBe(builtin.color)
      }
    }
  })
})
