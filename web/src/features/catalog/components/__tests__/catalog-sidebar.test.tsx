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

// `@/lib/lobe-icon` -> `@lobehub/ui` -> a JSON data set the test loader cannot
// resolve. Stubbed at that boundary; the vendor mark is not what is under test.
vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { CatalogSidebar } = await import('../catalog-sidebar')

const i18n = createInstance()
await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: {} } })

const LONG_NAME =
  'accounts/fireworks/models/qwen3-235b-a22b-instruct-2507-fp8-preview'

type Props = Parameters<typeof CatalogSidebar>[0]

function makeItem(modelName: string): Props['vendorGroups'][number]['items'][number] {
  return {
    modelName,
    vendorName: 'Fireworks',
    vendorIcon: '',
    status: 'on_sale',
    channelCount: 2,
    enabledChannelCount: 2,
  } as Props['vendorGroups'][number]['items'][number]
}

function renderSidebar(modelNames: string[] = [LONG_NAME]) {
  render(
    <I18nextProvider i18n={i18n}>
      <CatalogSidebar
        vendorGroups={[
          {
            vendorName: 'Fireworks',
            vendorIcon: '',
            items: modelNames.map(makeItem),
          } as Props['vendorGroups'][number],
        ]}
        totalCount={modelNames.length}
        matchedCount={modelNames.length}
        selectedModel={null}
        onSelectModel={vi.fn()}
        search=''
        onSearchChange={vi.fn()}
        onCreateModel={vi.fn()}
      />
    </I18nextProvider>
  )
}

describe('catalog rail model names', () => {
  test('renders a long model name in full, with no truncation', () => {
    renderSidebar()

    const name = screen.getByText(LONG_NAME)

    expect(name).toBeInTheDocument()
    // `truncate` is the class that produced the ellipsis this rail must not have.
    // Asserting its absence is the point: the name reads in full only because no
    // ancestor clips it.
    expect(name.className).not.toMatch(/\btruncate\b/)
    expect(name.className).not.toMatch(/\btext-ellipsis\b/)
    expect(name.className).toMatch(/\bwrap-anywhere\b/)
  })

  test('wraps rather than clips, so no ancestor hides the overflow', () => {
    renderSidebar()

    let node: HTMLElement | null = screen.getByText(LONG_NAME)
    const clipping: string[] = []

    while (node && node.tagName !== 'BODY') {
      if (/\b(truncate|overflow-hidden|text-ellipsis)\b/.test(node.className)) {
        clipping.push(node.className)
      }
      node = node.parentElement
    }

    // The scroll viewport legitimately hides vertical overflow, so this asserts
    // only that nothing between the name and the rail clips it horizontally.
    expect(clipping.filter((cls) => /\btruncate\b/.test(cls))).toEqual([])
  })

  test('keeps the channel count on the first line of a wrapped name', () => {
    renderSidebar()

    // The count is a sibling of the name inside a row that starts its children at
    // the top, so a two-line name cannot drag the count to its middle.
    const row = screen.getByText(LONG_NAME).closest('button')

    expect(row?.className).toMatch(/\bitems-start\b/)
    expect(row?.className).not.toMatch(/\bitems-center\b/)
  })

  test('still shows a short name without change', () => {
    renderSidebar(['gpt-5.5'])

    expect(screen.getByText('gpt-5.5')).toBeInTheDocument()
  })

  test('renders the name in the monospace face it is matched against', () => {
    // Model names are compared character by character against an upstream console,
    // so the face matters as much as the size: a proportional face makes `rn` and
    // `m`, or `l` and `1`, the same shape. The size itself is a preference that has
    // moved several times and is asserted relatively in the type-scale test, not
    // pinned here.
    renderSidebar()

    expect(screen.getByText(LONG_NAME).className).toMatch(/\bfont-mono\b/)
  })
})
