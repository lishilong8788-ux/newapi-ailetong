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
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { TagInput } from '@/components/tag-input'

function optionValues(): string[] {
  return [...document.querySelectorAll('datalist option')].map(
    (option) => (option as HTMLOptionElement).value
  )
}

function renderTagInput(props: {
  value?: string[]
  suggestions?: string[]
}): HTMLInputElement {
  render(
    <>
      <label htmlFor='tags-field'>Tags</label>
      <TagInput
        id='tags-field'
        value={props.value ?? []}
        onChange={() => undefined}
        suggestions={props.suggestions}
      />
    </>
  )
  // Through the label, because that association is itself the contract: the
  // widget renders a bordered wrapper around its input, and a `htmlFor` landing
  // on the wrapper would name nothing.
  return screen.getByLabelText('Tags') as HTMLInputElement
}

describe('TagInput suggestions', () => {
  test('offers the supplied vocabulary as a list attached to the input', () => {
    const input = renderTagInput({ suggestions: ['hot', 'long-context'] })

    const list = input.getAttribute('list')
    expect(document.querySelector(`datalist[id="${list}"]`)).toBeInTheDocument()
    expect(optionValues()).toEqual(['hot', 'long-context'])
    // A list-bound text input is a combobox to assistive tech, which is the
    // point of using the native element: the popup and its keyboard traversal
    // come from the browser rather than from a bespoke listbox.
    expect(screen.getByRole('combobox', { name: 'Tags' })).toBe(input)
  })

  test('omits values already attached to the model', () => {
    renderTagInput({ value: ['hot'], suggestions: ['hot', 'long-context'] })

    expect(optionValues()).toEqual(['long-context'])
  })

  test('leaves the input unlinked when nothing is left to suggest', () => {
    const input = renderTagInput({ value: ['hot'], suggestions: ['hot'] })

    expect(input).not.toHaveAttribute('list')
    expect(optionValues()).toEqual([])
  })
})
