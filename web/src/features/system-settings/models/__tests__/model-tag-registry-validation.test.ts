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

import { TAG_LIMITS } from '@/lib/model-tags'

import {
  addCustomTagRow,
  applyTagRowEdit,
  buildTagRegistryRows,
  groupTagRegistryIssues,
  validateTagRegistryRows,
  type TagLabelTranslator,
  type TagRegistryRow,
} from '../model-tag-registry-core'

const translate: TagLabelTranslator = (_language, key) => key

/** A registry holding exactly the given custom rows, built through the editor. */
function withCustomRows(
  entries: Array<Partial<TagRegistryRow> & { slug: string }>
): TagRegistryRow[] {
  let rows = buildTagRegistryRows('', translate).rows
  entries.forEach((entry, index) => {
    const id = `new:${index}`
    rows = addCustomTagRow(rows, id)
    rows = applyTagRowEdit(rows, id, {
      slug: entry.slug,
      color: entry.color ?? 'blue',
      kind: entry.kind ?? 'capability',
      labels: entry.labels ?? { en: entry.slug },
      aliases: entry.aliases ?? [],
    })
  })
  return rows
}

function codes(rows: TagRegistryRow[]): string[] {
  return validateTagRegistryRows(rows).map((issue) => issue.code)
}

describe('tag registry validation', () => {
  test('accepts an untouched registry with no issues', () => {
    const { rows } = buildTagRegistryRows('', translate)

    expect(validateTagRegistryRows(rows)).toEqual([])
  })

  test('rejects two slugs that collide only after normalization', () => {
    const rows = withCustomRows([{ slug: 'Long Context X' }, { slug: 'long_context_x' }])

    const issues = validateTagRegistryRows(rows)
    const duplicate = issues.find((issue) => issue.code === 'slug-duplicate')

    expect(duplicate).toBeDefined()
    expect(duplicate?.rowId).toBe('new:1')
    expect(duplicate?.field).toBe('slug')
  })

  test('rejects an alias that names another entry slug', () => {
    const rows = withCustomRows([
      { slug: 'flagship' },
      { slug: 'premium', aliases: ['Flagship'] },
    ])

    const issues = validateTagRegistryRows(rows)
    const conflict = issues.find((issue) => issue.code === 'alias-conflicts-slug')

    expect(conflict?.rowId).toBe('new:1')
    expect(conflict?.params?.alias).toBe('Flagship')
  })

  test('rejects the same alias claimed by two entries', () => {
    const rows = withCustomRows([
      { slug: 'flagship', aliases: ['旗舰'] },
      { slug: 'premium', aliases: ['旗舰'] },
    ])

    const issues = validateTagRegistryRows(rows)
    const duplicate = issues.find((issue) => issue.code === 'alias-duplicate')

    expect(duplicate?.rowId).toBe('new:1')
  })

  test('accepts an alias that repeats inside its own row', () => {
    const rows = withCustomRows([{ slug: 'flagship', aliases: ['旗舰', '旗舰'] }])

    expect(codes(rows)).toEqual([])
  })

  test('rejects a colour outside the renderable set', () => {
    const rows = withCustomRows([{ slug: 'flagship', color: 'slate' }])

    const issues = validateTagRegistryRows(rows)
    const unknown = issues.find((issue) => issue.code === 'unknown-color')

    expect(unknown?.field).toBe('color')
    expect(unknown?.params?.color).toBe('slate')
  })

  test('rejects a category outside the three known kinds', () => {
    const rows = withCustomRows([{ slug: 'flagship', kind: 'marketing' }])

    expect(codes(rows)).toContain('unknown-kind')
  })

  test('rejects an empty slug on an added row', () => {
    const rows = addCustomTagRow(buildTagRegistryRows('', translate).rows, 'new:0')

    const issues = validateTagRegistryRows(rows)

    expect(issues.map((issue) => issue.code)).toContain('slug-required')
    expect(issues.find((issue) => issue.code === 'slug-required')?.rowId).toBe(
      'new:0'
    )
  })

  test('rejects a slug containing the storage separator', () => {
    const rows = withCustomRows([{ slug: 'fast,cheap' }])

    const issues = validateTagRegistryRows(rows)
    const forbidden = issues.find((issue) => issue.code === 'slug-forbidden-char')

    expect(forbidden?.params?.char).toBe(',')
  })

  test('rejects a missing English display name because it is the fallback', () => {
    const rows = withCustomRows([{ slug: 'flagship', labels: { zhCN: '旗舰' } }])

    const issues = validateTagRegistryRows(rows)
    const missing = issues.find((issue) => issue.code === 'label-required')

    expect(missing?.language).toBe('en')
    expect(missing?.field).toBe('label')
  })

  test('rejects a display name longer than the stored limit', () => {
    const rows = withCustomRows([
      {
        slug: 'flagship',
        labels: { en: 'x'.repeat(TAG_LIMITS.maxLabelLength + 1) },
      },
    ])

    expect(codes(rows)).toContain('label-too-long')
  })

  test('rejects more aliases than the backend accepts', () => {
    const rows = withCustomRows([
      {
        slug: 'flagship',
        aliases: Array.from(
          { length: TAG_LIMITS.maxAliases + 1 },
          (_value, index) => `alias-${index}`
        ),
      },
    ])

    const issues = validateTagRegistryRows(rows)
    const tooMany = issues.find((issue) => issue.code === 'too-many-aliases')

    expect(tooMany?.params?.max).toBe(TAG_LIMITS.maxAliases)
  })

  test('rejects a registry over the entry cap and reports the count', () => {
    const entries = Array.from(
      { length: TAG_LIMITS.maxRegistryEntries + 1 },
      (_value, index) => ({ slug: `custom-tag-${index}` })
    )
    const rows = withCustomRows(entries)

    const issues = validateTagRegistryRows(rows)
    const overCap = issues.find((issue) => issue.code === 'too-many-entries')

    expect(overCap?.rowId).toBeUndefined()
    expect(overCap?.params?.count).toBe(TAG_LIMITS.maxRegistryEntries + 1)
  })

  test('ignores an untouched built-in when counting entries against the cap', () => {
    const entries = Array.from(
      { length: TAG_LIMITS.maxRegistryEntries },
      (_value, index) => ({ slug: `custom-tag-${index}` })
    )
    const rows = withCustomRows(entries)

    expect(codes(rows)).toEqual([])
  })

  test('groups issues under the row that produced them', () => {
    const rows = withCustomRows([
      { slug: 'flagship', color: 'slate', labels: { zhCN: '旗舰' } },
    ])

    const grouped = groupTagRegistryIssues(validateTagRegistryRows(rows))

    expect(grouped.get('new:0')?.map((issue) => issue.code)).toEqual([
      'unknown-color',
      'label-required',
    ])
  })
})
