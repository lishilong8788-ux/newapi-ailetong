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

import { BUILTIN_TAGS, resolveTag, type TagDefinition } from '@/lib/model-tags'

import {
  applyTagRowEdit,
  buildTagRegistryRows,
  serializeTagRegistryRows,
  type TagLabelTranslator,
} from '../model-tag-registry-core'

// ---------------------------------------------------------------------------
// What these tests protect
// ---------------------------------------------------------------------------
//
// `resolveTag` consults the operator registry first and the built-in vocabulary
// second, and the built-in alias map is always fully populated independently of
// the registry. So an override that omits the built-in's aliases does NOT stop
// `热门` from resolving — it splits it: `hot` paints the operator's colour while
// `热门` still paints the built-in's. One concept, two colours, which is the
// exact defect the shared vocabulary exists to prevent.
//
// These tests therefore assert what the catalog would paint, through the real
// resolver, rather than the shape of the JSON this editor emits.

const translate: TagLabelTranslator = (_language, key) => key
const t = (key: string) => key

/** Resolve through the production resolver, as the catalog does. */
function paint(tag: string, registry: TagDefinition[]) {
  return resolveTag(tag, { registry, t, language: 'en' })
}

function overrideHotColor(color: string): TagDefinition[] {
  const { rows } = buildTagRegistryRows('', translate)
  const edited = applyTagRowEdit(rows, 'builtin:hot', { color })
  return JSON.parse(serializeTagRegistryRows(edited)) as TagDefinition[]
}

describe('alias resolution survives an operator override', () => {
  test('changing only the colour repaints the slug and every legacy spelling alike', () => {
    const registry = overrideHotColor('warning')

    // The whole promise of `aliases`: a model tagged 热门 and one tagged hot
    // must agree, with no edit to either model.
    expect(paint('hot', registry).variant).toBe('warning')
    expect(paint('热门', registry).variant).toBe('warning')
    expect(paint('popular', registry).variant).toBe('warning')
  })

  test('every legacy spelling still lands on the same canonical slug', () => {
    const registry = overrideHotColor('warning')

    expect(paint('热门', registry).slug).toBe('hot')
    expect(paint('popular', registry).slug).toBe('hot')
    expect(paint('热门', registry).known).toBe(true)
  })

  test('an override with no aliases inherits the built-in ones instead of splitting', () => {
    // Hand-built the way a careless JSON paste would leave it: correct slug, no
    // aliases at all. This used to split the tag — `hot` took the override while
    // `热门` fell through to the built-in, so one logical tag painted two
    // colours. `resolveTag` now merges an override onto the built-in of the same
    // slug, so the inherited aliases follow the override.
    const aliasless: TagDefinition[] = [
      { slug: 'hot', color: 'warning', kind: 'promo', labels: { en: 'Hot' } },
    ]

    expect(paint('hot', aliasless).variant).toBe('warning')
    expect(paint('热门', aliasless).variant).toBe('warning')
    expect(paint('popular', aliasless).variant).toBe('warning')
  })

  test('editing a non-alias field never drops the aliases it did not touch', () => {
    const { rows } = buildTagRegistryRows('', translate)

    for (const field of [
      { color: 'blue' },
      { kind: 'lifecycle' },
      { labels: { en: 'Trending' } },
    ]) {
      const edited = applyTagRowEdit(rows, 'builtin:hot', field)
      const entry = (JSON.parse(serializeTagRegistryRows(edited)) as TagDefinition[])[0]

      expect(entry.aliases).toEqual(['热门', 'popular'])
    }
  })

  test('every built-in carries its full alias list into an override', () => {
    const { rows } = buildTagRegistryRows('', translate)

    for (const builtin of BUILTIN_TAGS) {
      if (builtin.aliases.length === 0) continue
      const edited = applyTagRowEdit(rows, `builtin:${builtin.slug}`, {
        color: 'teal',
      })
      const entries = JSON.parse(
        serializeTagRegistryRows(edited)
      ) as TagDefinition[]

      expect(entries).toHaveLength(1)
      expect(entries[0].slug).toBe(builtin.slug)
      expect(entries[0].aliases).toEqual(builtin.aliases)

      // And the recoloured entry must claim every one of those spellings.
      for (const alias of builtin.aliases) {
        expect(paint(alias, entries).variant).toBe('teal')
      }
    }
  })
})
