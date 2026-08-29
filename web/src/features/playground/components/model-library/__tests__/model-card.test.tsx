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
import { describe, expect, test, vi } from 'vitest'

// Vendor marks resolve through `getLobeIcon`, which transitively loads
// `@lobehub/fluent-emoji`'s directory-style ES import that the loader cannot
// resolve. Stubbed at the same boundary the sheet and guide suites use.
vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

import type { ModelOption } from '../../../types'
import { ModelCard } from '../model-card'

/**
 * `video` is `available: false` in the registry, so this renders "Coming soon" —
 * which is what the badge-layout assertions below need present. The modality is
 * incidental to the layout being pinned; it just has to be an unopened one.
 */
const PATH_SHAPED: ModelOption = {
  label: 'Wan-AI/Wan2.2-T2V-A14B',
  value: 'Wan-AI/Wan2.2-T2V-A14B',
  modality: 'video',
}

function renderCard(model: ModelOption) {
  render(
    <ModelCard
      model={model}
      isSelected={false}
      activeModality='all'
      onSelect={vi.fn()}
    />
  )
}

describe('ModelCard', () => {
  test('lets a path-shaped id wrap instead of clipping its tail', () => {
    // Vendors publish families of path-shaped ids that share a long prefix, so
    // clipping the tail removed the only part that differed and two distinct
    // models rendered as identical rows.
    //
    // Asserted on the class rather than on geometry: jsdom does no layout, so
    // `truncate` and `line-clamp-2` produce byte-identical `textContent` and a
    // `getByText` check here passes just as happily against the bug.
    renderCard(PATH_SHAPED)

    const name = screen.getByText('Wan-AI/Wan2.2-T2V-A14B')

    expect(name).toHaveClass('line-clamp-2')
    expect(name).not.toHaveClass('truncate')
  })

  test('puts the name and both badges in one flow row', () => {
    // The badges were absolutely positioned, with the name's column carrying a
    // 48px reserve to stay clear of them — under half what the modality plus
    // "Coming soon" pair actually occupies, so the name ran underneath them.
    // Making them siblings is what removes the overlap, so that is what is
    // pinned here: pulling them back out into an absolute layer fails this.
    renderCard(PATH_SHAPED)

    const name = screen.getByText('Wan-AI/Wan2.2-T2V-A14B')
    const row = name.parentElement

    expect(row).not.toBeNull()
    expect(row).toContainElement(screen.getByText('Video'))
    expect(row).toContainElement(screen.getByText('Coming soon'))
  })

  test('drops the modality badge once the list is already filtered to it', () => {
    render(
      <ModelCard
        model={PATH_SHAPED}
        isSelected={false}
        activeModality='video'
        onSelect={vi.fn()}
      />
    )

    expect(screen.queryByText('Video')).not.toBeInTheDocument()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
  })
})
