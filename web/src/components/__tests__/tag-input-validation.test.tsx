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
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, test } from 'vitest'

import { TagInput } from '@/components/tag-input'
import { createModelTagValidator } from '@/features/models/lib/model-utils'
import { TAG_LIMITS } from '@/lib/model-tags'

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      translation: {
        'Add tags...': 'Add tags...',
        'Tag cannot be empty': 'Tag cannot be empty',
        'Tags cannot contain "{{char}}"': 'Tags cannot contain "{{char}}"',
        'Tags are limited to {{max}} characters':
          'Tags are limited to {{max}} characters',
        'This tag is already added': 'This tag is already added',
        'At most {{max}} tags per model': 'At most {{max}} tags per model',
      },
    },
  },
})

const modelTagValidator = createModelTagValidator(i18n.t)

/**
 * `validated` mirrors the model editors, `undefined` the prefill group editor.
 * The same widget serves both, so every assertion here is about which contract
 * is in force.
 */
function Harness(props: { initial?: string[]; validated: boolean }) {
  const [tags, setTags] = useState<string[]>(props.initial ?? [])

  return (
    <I18nextProvider i18n={i18n}>
      <TagInput
        value={tags}
        onChange={setTags}
        validate={props.validated ? modelTagValidator : undefined}
      />
      <output data-testid='stored'>{tags.join('|')}</output>
    </I18nextProvider>
  )
}

function renderTagInput(options: {
  initial?: string[]
  validated: boolean
}): HTMLInputElement {
  render(<Harness initial={options.initial} validated={options.validated} />)
  return screen.getByRole('textbox') as HTMLInputElement
}

function type(input: HTMLInputElement, text: string): void {
  fireEvent.change(input, { target: { value: text } })
}

function commit(input: HTMLInputElement): void {
  fireEvent.keyDown(input, { key: 'Enter' })
}

function paste(input: HTMLInputElement, text: string): void {
  fireEvent.paste(input, { clipboardData: { getData: () => text } })
}

function stored(): string {
  return screen.getByTestId('stored').textContent ?? ''
}

describe('TagInput with a validator', () => {
  test('accepts a tag that passes and clears the field', () => {
    const input = renderTagInput({ validated: true })

    type(input, 'reasoning')
    commit(input)

    expect(stored()).toBe('reasoning')
    expect(input).toHaveValue('')
  })

  test('refuses a tag containing the storage separator and keeps the text to fix', () => {
    const input = renderTagInput({ validated: true })

    type(input, 'fast;cheap')
    commit(input)

    expect(stored()).toBe('')
    expect(input).toHaveValue('fast;cheap')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tags cannot contain ";"'
    )
  })

  test('refuses a tag that repeats an existing one in different case', () => {
    const input = renderTagInput({ initial: ['hot'], validated: true })

    type(input, 'Hot')
    commit(input)

    expect(stored()).toBe('hot')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This tag is already added'
    )
  })

  test('refuses a tag longer than the slug limit', () => {
    const input = renderTagInput({ validated: true })
    const tooLong = 'a'.repeat(TAG_LIMITS.maxSlugLength + 1)

    type(input, tooLong)
    commit(input)

    expect(stored()).toBe('')
    expect(screen.getByRole('alert')).toHaveTextContent(
      `Tags are limited to ${TAG_LIMITS.maxSlugLength} characters`
    )
  })

  test('refuses a tag past the per-model count limit', () => {
    const full = Array.from(
      { length: TAG_LIMITS.maxTagsPerModel },
      (_, index) => `tag-${index}`
    )
    const input = renderTagInput({ initial: full, validated: true })

    type(input, 'one-too-many')
    commit(input)

    expect(stored()).toBe(full.join('|'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      `At most ${TAG_LIMITS.maxTagsPerModel} tags per model`
    )
  })

  test('clears the message on the next keystroke', () => {
    const input = renderTagInput({ validated: true })

    type(input, 'a,b')
    commit(input)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    type(input, 'ab')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  test('describes the refusal to assistive tech through the input', () => {
    const input = renderTagInput({ validated: true })

    type(input, 'a|b')
    commit(input)

    const message = screen.getByRole('alert')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBe(message.id)
  })

  test('keeps a refused value in the field when focus leaves it', () => {
    const input = renderTagInput({ validated: true })

    type(input, 'bad|tag')
    fireEvent.blur(input)

    expect(stored()).toBe('')
    expect(input).toHaveValue('bad|tag')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tags cannot contain "|"'
    )
  })

  test('commits a valid value when focus leaves the field', () => {
    const input = renderTagInput({ validated: true })

    type(input, 'vision')
    fireEvent.blur(input)

    expect(stored()).toBe('vision')
    expect(input).toHaveValue('')
  })
})

describe('TagInput paste', () => {
  test('splits a comma-separated paste into one tag per value', () => {
    const input = renderTagInput({ validated: true })

    paste(input, 'hot,new,vision')

    expect(stored()).toBe('hot|new|vision')
    expect(input).toHaveValue('')
  })

  test('splits a newline-separated paste and drops the trailing blank', () => {
    const input = renderTagInput({ validated: true })

    paste(input, 'hot\nnew\n')

    expect(stored()).toBe('hot|new')
  })

  test('stops at the first refused value and leaves the rest to fix', () => {
    const input = renderTagInput({ validated: true })

    paste(input, 'hot,bad;tag,vision')

    expect(stored()).toBe('hot')
    expect(input).toHaveValue('bad;tag,vision')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tags cannot contain ";"'
    )
  })

  test('appends a paste to text already typed', () => {
    const input = renderTagInput({ validated: true })

    type(input, 'lo')
    paste(input, 'ng-context,vision')

    expect(stored()).toBe('long-context|vision')
  })

  test('leaves a single-value paste in the field for further editing', () => {
    const input = renderTagInput({ validated: true })

    paste(input, 'reasoning')

    expect(stored()).toBe('')
  })
})

describe('TagInput without a validator', () => {
  test('stores a comma-bearing value verbatim, as prefill groups expect', () => {
    const input = renderTagInput({ validated: false })

    paste(input, 'a,b,c')
    type(input, 'a,b,c')
    commit(input)

    expect(stored()).toBe('a,b,c')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('accepts values the model rules would refuse', () => {
    const input = renderTagInput({ validated: false })

    type(input, '/v1/chat/completions|responses')
    commit(input)
    type(input, 'a'.repeat(TAG_LIMITS.maxSlugLength + 1))
    commit(input)

    expect(stored()).toBe(
      `/v1/chat/completions|responses|${'a'.repeat(TAG_LIMITS.maxSlugLength + 1)}`
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('skips an exact duplicate silently', () => {
    const input = renderTagInput({ initial: ['hot'], validated: false })

    type(input, 'hot')
    commit(input)

    expect(stored()).toBe('hot')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
