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
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import {
  buildTagRegistryRows,
  type TagLabelTranslator,
  type TagRegistryIssue,
  type TagRegistryRow,
} from '../model-tag-registry-core'
import { ModelTagRegistryRow } from '../model-tag-registry-row'

const translate: TagLabelTranslator = (_language, key) => key

function builtinRow(slug: string): TagRegistryRow {
  const row = buildTagRegistryRows('', translate).rows.find(
    (candidate) => candidate.slug === slug
  )
  if (!row) throw new Error(`built-in tag ${slug} is missing`)
  return row
}

function renderRow(row: TagRegistryRow, issues: TagRegistryIssue[] = []) {
  const onPatch = vi.fn()
  render(
    <ModelTagRegistryRow
      row={row}
      issues={issues}
      previewVariant={row.color as 'red'}
      previewLabel={row.labels.en ?? ''}
      onPatch={onPatch}
      onReset={vi.fn()}
      onRemove={vi.fn()}
    />
  )
  return onPatch
}

/** Open the collapsed panel holding the display names and aliases. */
function expandDetails() {
  fireEvent.click(screen.getByRole('button', { name: 'Names & aliases' }))
}

describe('model tag registry row', () => {
  test('seeds the English display name and leaves an untranslated language empty', () => {
    // The stub translator returns the key for every language, standing in for a
    // locale file whose entry is still the English placeholder. Those are left
    // blank rather than frozen into the operator's data; they render through the
    // English fallback either way.
    renderRow(builtinRow('hot'))
    expandDetails()

    expect(screen.getByLabelText('English (required)')).toHaveValue('Hot')
    expect(screen.getByLabelText('简体中文')).toHaveValue('')
  })

  test('shows the English fallback as the placeholder for an unset language', () => {
    renderRow(builtinRow('hot'))
    expandDetails()

    expect(screen.getByLabelText('简体中文')).toHaveAttribute(
      'placeholder',
      'Hot'
    )
  })

  test('reports an edited display name as a patch for that language only', () => {
    const onPatch = renderRow(builtinRow('hot'))
    expandDetails()

    fireEvent.change(screen.getByLabelText('English (required)'), {
      target: { value: 'Trending' },
    })

    expect(onPatch).toHaveBeenCalledWith(
      'builtin:hot',
      expect.objectContaining({
        labels: expect.objectContaining({ en: 'Trending' }),
      })
    )
  })

  test('parses the comma separated alias field into individual aliases', () => {
    const onPatch = renderRow(builtinRow('hot'))
    expandDetails()

    fireEvent.change(screen.getByLabelText('Aliases (comma separated)'), {
      target: { value: '热门, popular , ' },
    })

    expect(onPatch).toHaveBeenCalledWith('builtin:hot', {
      aliases: ['热门', 'popular'],
    })
  })

  test('keeps the built-in slug read-only so an override cannot be orphaned', () => {
    renderRow(builtinRow('hot'))

    expect(screen.queryByLabelText('Tag identifier')).not.toBeInTheDocument()
    expect(screen.getByText('hot')).toBeInTheDocument()
  })

  test('disables restoring defaults on a built-in row that was never changed', () => {
    renderRow(builtinRow('hot'))

    expect(
      screen.getByRole('button', { name: 'Restore built-in default: hot' })
    ).toBeDisabled()
  })

  test('exposes the detail panel state through aria-expanded', () => {
    renderRow(builtinRow('hot'))

    const toggle = screen.getByRole('button', { name: 'Names & aliases' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  test('opens the collapsed panel by itself when it hides a failing field', () => {
    renderRow(builtinRow('hot'), [
      {
        code: 'alias-duplicate',
        rowId: 'builtin:hot',
        field: 'aliases',
        params: { alias: '热门' },
      },
    ])

    expect(
      screen.getByRole('button', { name: 'Names & aliases' })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByLabelText('Aliases (comma separated)')
    ).toHaveAttribute('aria-invalid', 'true')
  })

  test('associates a field message with the input that failed', () => {
    renderRow(builtinRow('hot'), [
      { code: 'label-required', rowId: 'builtin:hot', field: 'label', language: 'en' },
    ])

    const input = screen.getByLabelText('English (required)')
    const describedBy = input.getAttribute('aria-describedby')
    const message = screen.getByText(
      'An English display name is required, it is the fallback'
    )

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(describedBy).toBeTruthy()
    expect(message.id).toBe(describedBy)
  })
})
