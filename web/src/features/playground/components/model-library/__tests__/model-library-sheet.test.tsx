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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

// The card renders vendor marks through `getLobeIcon`, which transitively loads
// `@lobehub/fluent-emoji`'s directory-style ES import that the loader cannot
// resolve. Stubbed at the same boundary the pricing and guide suites use.
vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

import type { GroupOption, ModelOption } from '../../../types'
import { ModelLibrarySheet } from '../model-library-sheet'

/** One usable group, which is what most deployments give a user. */
const GROUPS: GroupOption[] = [{ label: 'default', value: 'default', ratio: 1 }]

const MODELS: ModelOption[] = [
  {
    label: 'claude-opus-5',
    value: 'claude-opus-5',
    modality: 'chat',
    vendorName: 'Anthropic',
    vendorId: 1,
  },
  {
    label: 'gpt-4o',
    value: 'gpt-4o',
    modality: 'chat',
    vendorName: 'OpenAI',
    vendorId: 2,
  },
]

function renderSheet(onSelectModel = vi.fn(), groups = GROUPS) {
  render(
    <ModelLibrarySheet
      models={MODELS}
      selectedModel='claude-opus-5'
      isLoading={false}
      onSelectModel={onSelectModel}
      groups={groups}
      groupValue='default'
      onGroupChange={vi.fn()}
    />
  )
  return onSelectModel
}

describe('ModelLibrarySheet', () => {
  test('the trigger names the active model while the drawer is closed', () => {
    renderSheet()

    // Below `lg` the sidebar is hidden and this button is the only trace of the
    // library on screen. A bare grid icon left "who am I talking to?"
    // unanswered for the whole width range where it matters most.
    const trigger = screen.getByRole('button', { name: 'Model library' })

    expect(trigger).toHaveTextContent('claude-opus-5')
  })

  test('the library is not mounted until the trigger is used', () => {
    renderSheet()

    // The drawer is the only path to the library below `lg`; before opening it,
    // its contents (the search box) must not be in the tree.
    expect(
      screen.queryByPlaceholderText('Search models')
    ).not.toBeInTheDocument()
  })

  test('opening the drawer reveals the library', async () => {
    renderSheet()

    await userEvent.click(screen.getByRole('button', { name: 'Model library' }))

    expect(
      await screen.findByPlaceholderText('Search models')
    ).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
  })

  test('picking a model reports it and closes the drawer', async () => {
    const onSelectModel = renderSheet()

    await userEvent.click(screen.getByRole('button', { name: 'Model library' }))
    await userEvent.click(await screen.findByText('gpt-4o'))

    expect(onSelectModel).toHaveBeenCalledWith('gpt-4o')
    // On a narrow screen the point is to choose and get back to the composer,
    // so the drawer should not linger open.
    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText('Search models')
      ).not.toBeInTheDocument()
    })
  })
})
