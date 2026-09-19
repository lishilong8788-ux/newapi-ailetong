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

import type { TagDefinition } from '@/lib/model-tags'

import {
  addCustomTagRow,
  applyTagRowEdit,
  buildTagRegistryRows,
  removeTagRow,
  resetTagRow,
  serializeTagRegistryRows,
  type TagLabelTranslator,
} from '../model-tag-registry-core'

// Built-in labels come from i18next in production. Here the language is folded
// into the returned string so a seeded override is visibly per-language.
const translate: TagLabelTranslator = (language, key) =>
  language === 'en' ? key : `${key} (${language})`

function parse(value: string): TagDefinition[] {
  return JSON.parse(value) as TagDefinition[]
}

describe('tag registry serialization', () => {
  test('writes nothing when no built-in tag was touched', () => {
    const { rows } = buildTagRegistryRows('', translate)

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.origin === 'builtin')).toBe(true)
    expect(serializeTagRegistryRows(rows)).toBe('')
  })

  test('writes a full override entry when a built-in colour is changed', () => {
    const { rows } = buildTagRegistryRows('', translate)
    const edited = applyTagRowEdit(rows, 'builtin:hot', { color: 'warning' })

    const entries = parse(serializeTagRegistryRows(edited))

    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      slug: 'hot',
      color: 'warning',
      kind: 'promo',
      labels: {
        en: 'Hot',
        zhCN: 'Hot (zhCN)',
        fr: 'Hot (fr)',
        ru: 'Hot (ru)',
        ja: 'Hot (ja)',
        vi: 'Hot (vi)',
        zhTW: 'Hot (zhTW)',
      },
      aliases: ['热门', 'popular'],
    })
  })

  test('keeps only the edited tag when one of many built-ins is changed', () => {
    const { rows } = buildTagRegistryRows('', translate)
    const edited = applyTagRowEdit(rows, 'builtin:reasoning', {
      kind: 'lifecycle',
    })

    const entries = parse(serializeTagRegistryRows(edited))

    expect(entries.map((entry) => entry.slug)).toEqual(['reasoning'])
    expect(entries[0].kind).toBe('lifecycle')
  })

  test('restores the built-in default and stops persisting it after a reset', () => {
    const saved = JSON.stringify([
      { slug: 'hot', color: 'warning', kind: 'promo', labels: { en: 'Trending' } },
    ])
    const { rows } = buildTagRegistryRows(saved, translate)
    const hot = rows.find((row) => row.id === 'builtin:hot')

    expect(hot?.overridden).toBe(true)
    expect(hot?.color).toBe('warning')

    const reset = resetTagRow(rows, 'builtin:hot')
    const restored = reset.find((row) => row.id === 'builtin:hot')

    expect(restored?.overridden).toBe(false)
    expect(restored?.color).toBe('red')
    expect(serializeTagRegistryRows(reset)).toBe('')
  })

  test('uses the saved labels verbatim instead of merging built-in defaults', () => {
    const saved = JSON.stringify([
      { slug: 'hot', color: 'red', kind: 'promo', labels: { en: 'Trending' } },
    ])
    const { rows } = buildTagRegistryRows(saved, translate)

    const entries = parse(serializeTagRegistryRows(rows))

    expect(entries[0].labels).toEqual({ en: 'Trending' })
  })

  test('omits a language whose translation is only the English placeholder', () => {
    // Reproduces the real locale files: the i18n sync tool writes an
    // untranslated entry as the English text, so `vi.json` holds
    // `"Hot": "Hot"`. Persisting that would freeze the placeholder into the
    // operator's data and strand `vi` on the old word after an English rename.
    const withPlaceholders: TagLabelTranslator = (language, key) => {
      if (language === 'zhCN') return '热门'
      return key
    }
    const { rows } = buildTagRegistryRows('', withPlaceholders)
    const edited = applyTagRowEdit(rows, 'builtin:hot', { color: 'warning' })

    const entries = parse(serializeTagRegistryRows(edited))

    expect(entries[0].labels).toEqual({ en: 'Hot', zhCN: '热门' })
    expect(entries[0].labels).not.toHaveProperty('vi')
    expect(entries[0].labels).not.toHaveProperty('fr')
  })

  test('keeps a language code the built-in vocabulary does not know', () => {
    const saved = JSON.stringify([
      { slug: 'hot', color: 'red', labels: { en: 'Hot', 'zh-CN': '热门' } },
    ])
    const { rows } = buildTagRegistryRows(saved, translate)

    const entries = parse(serializeTagRegistryRows(rows))

    expect(entries[0].labels).toEqual({ en: 'Hot', 'zh-CN': '热门' })
  })

  test('serializes an operator-added tag with a normalized slug', () => {
    const { rows } = buildTagRegistryRows('', translate)
    const added = addCustomTagRow(rows, 'new:0')
    const filled = applyTagRowEdit(added, 'new:0', {
      slug: 'Flagship Model',
      color: 'violet',
      kind: 'promo',
      labels: { en: 'Flagship' },
      aliases: ['旗舰'],
    })

    const entries = parse(serializeTagRegistryRows(filled))

    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      slug: 'flagship-model',
      color: 'violet',
      kind: 'promo',
      labels: { en: 'Flagship' },
      aliases: ['旗舰'],
    })
  })

  test('drops blank aliases and de-duplicates them by normalized form', () => {
    const { rows } = buildTagRegistryRows('', translate)
    const added = addCustomTagRow(rows, 'new:0')
    const filled = applyTagRowEdit(added, 'new:0', {
      slug: 'fast',
      labels: { en: 'Fast' },
      aliases: ['Quick ', '  ', 'quick', 'Low Latency', 'low_latency'],
    })

    const entries = parse(serializeTagRegistryRows(filled))

    expect(entries[0].aliases).toEqual(['Quick', 'Low Latency'])
  })

  test('drops an empty labels map rather than writing an empty object', () => {
    const { rows } = buildTagRegistryRows('', translate)
    const added = addCustomTagRow(rows, 'new:0')
    const filled = applyTagRowEdit(added, 'new:0', {
      slug: 'fast',
      labels: { en: '   ' },
    })

    const entries = parse(serializeTagRegistryRows(filled))

    expect(entries[0]).not.toHaveProperty('labels')
    expect(entries[0]).not.toHaveProperty('aliases')
  })

  test('removes a custom row but keeps a built-in row on the same call', () => {
    const { rows } = buildTagRegistryRows('', translate)
    const added = addCustomTagRow(rows, 'new:0')

    expect(removeTagRow(added, 'new:0')).toHaveLength(rows.length)
    expect(removeTagRow(added, 'builtin:hot')).toHaveLength(added.length)
  })

  test('surfaces a stored value that is not a JSON array', () => {
    const result = buildTagRegistryRows('{"slug":"hot"}', translate)

    expect(result.parseFailed).toBe(true)
    expect(serializeTagRegistryRows(result.rows)).toBe('')
  })

  test('keeps a duplicated stored slug as two rows so it can be reported', () => {
    const saved = JSON.stringify([
      { slug: 'hot', color: 'red' },
      { slug: 'Hot', color: 'blue' },
    ])
    const { rows } = buildTagRegistryRows(saved, translate)

    const hotRows = rows.filter((row) => row.slug.toLowerCase() === 'hot')

    expect(hotRows).toHaveLength(2)
    expect(hotRows.map((row) => row.origin)).toEqual(['builtin', 'custom'])
  })
})
