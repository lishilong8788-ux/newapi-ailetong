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
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { PriceComparisonTable } from '../components/price-comparison-table'
import {
  getPriceComparison,
  type PriceComparison,
  type PriceComparisonRow,
} from '../lib/price-comparison'
import type { PricingModel } from '../types'

// These tests cover the wiring between the comparison data and the rendered
// table — column count, which cell gets the strikethrough, where `-` lands. The
// lib-level tests verify the numbers; nothing there would catch a swapped prop or
// a header that outlives its column.

function buildModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'test-model',
    quota_type: 0,
    model_ratio: 0.96,
    completion_ratio: 5,
    enable_groups: ['default'],
    group_ratio: { default: 1 },
    ...overrides,
  }
}

function renderTable(model: PricingModel) {
  const comparison = getPriceComparison(model, { tokenUnit: 'M' })
  render(
    <PriceComparisonTable
      comparison={comparison}
      unitLabel='平台价/M'
      officialLabel='官方价/M'
    />
  )
  return comparison
}

/**
 * Render straight from hand-built rows, bypassing `getPriceComparison`.
 *
 * `calcDiscountRatio` never emits a ratio at or above 1, so going through a model
 * cannot reach the table's own handling of one. The table is a shared component
 * with an exported prop type, and the ratios it is handed come from two builders
 * plus whatever a future caller writes, so the ratio arrives as untrusted input
 * and is tested as such.
 */
function renderRows(rows: PriceComparisonRow[]) {
  const comparison: PriceComparison = {
    rows,
    ratio: 1,
    hasDiscount: false,
    hasOfficialPrice: true,
    officialDiscountRatio: null,
    isPerRequest: false,
  }
  render(
    <PriceComparisonTable
      comparison={comparison}
      unitLabel='平台价/M'
      officialLabel='官方价/M'
    />
  )
}

/** The data row for a price type, found via its label cell. */
function rowFor(label: string) {
  const cell = screen.getByRole('rowheader', { name: label })
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${label}`)
  return row
}

describe('PriceComparisonTable official price columns', () => {
  test('renders platform, official and discount columns when a comparison exists', () => {
    renderTable(
      buildModel({
        official_model_ratio: 7.5,
        official_completion_ratio: 5,
      })
    )

    expect(
      screen.getByRole('columnheader', { name: '平台价/M' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: '官方价/M' })
    ).toBeInTheDocument()

    const input = rowFor('Input')
    const cells = within(input).getAllByRole('cell')
    // platform, official, discount — the label is a rowheader, not a cell.
    expect(cells).toHaveLength(3)
    expect(cells[0]).toHaveTextContent('$1.92')
    expect(cells[1]).toHaveTextContent('$15')
    // The test env runs the English catalog, where the 0.13 ratio reads as its
    // complement. Under `zh` the same value renders "1.3折" via the
    // `{{tenths}}` form of this key.
    expect(cells[2]).toHaveTextContent('87% off')
  })

  test('strikes through the official price only where a discount is claimed', () => {
    renderTable(
      buildModel({
        // Input undercuts official; output is priced at parity with it.
        model_ratio: 0.96,
        completion_ratio: 15.625,
        official_model_ratio: 7.5,
        official_completion_ratio: 2,
      })
    )

    const inputOfficial = within(rowFor('Input')).getAllByRole('cell')[1]
    const outputOfficial = within(rowFor('Output')).getAllByRole('cell')[1]

    expect(inputOfficial.className).toContain('line-through')
    // No discount on this row, so no strikethrough: striking a price we do not
    // undercut would claim a saving that is not there.
    expect(outputOfficial.className).not.toContain('line-through')
    expect(within(rowFor('Output')).getAllByRole('cell')[2]).toHaveTextContent(
      '-'
    )
  })

  test('drops both columns when no row has an official price', () => {
    renderTable(buildModel())

    expect(
      screen.getByRole('columnheader', { name: '平台价/M' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: '官方价/M' })
    ).not.toBeInTheDocument()

    // Platform only — a two-column table reads as "this is the price".
    expect(within(rowFor('Input')).getAllByRole('cell')).toHaveLength(1)
  })

  test('keeps the columns but shows dashes for a row the vendor never priced', () => {
    renderTable(
      buildModel({
        cache_ratio: 0.1,
        official_model_ratio: 7.5,
        // No official completion/cache ratio published.
      })
    )

    expect(
      screen.getByRole('columnheader', { name: '官方价/M' })
    ).toBeInTheDocument()
    expect(within(rowFor('Input')).getAllByRole('cell')[1]).toHaveTextContent(
      '$15'
    )

    for (const label of ['Output', 'Cached']) {
      const cells = within(rowFor(label)).getAllByRole('cell')
      expect(cells[1]).toHaveTextContent('-')
      expect(cells[2]).toHaveTextContent('-')
    }
  })
})

describe('PriceComparisonTable discount pill above list price', () => {
  // This table is on the public catalog, so a ratio above 1 has no good pill:
  // "2.26折" claims a 77% saving and "-126% off" advertises the markup. The cell
  // stays a `-` and the note under the channel list carries the fact.
  test('leaves the discount cell empty for a platform price above official', () => {
    renderRows([
      {
        key: 'cache',
        labelKey: 'Cached',
        platform: '¥0.678',
        official: '¥0.3',
        // 0.678 / 0.3 — the channel whose cached reads cost more than buying
        // direct.
        discountRatio: 2.26,
      },
    ])

    const cells = within(rowFor('Cached')).getAllByRole('cell')
    expect(cells[2]).toHaveTextContent('-')
    expect(cells[2].textContent).not.toContain('折')
    expect(cells[2].textContent).not.toContain('off')
    // And no strikethrough: the official price is the cheaper of the two.
    expect(cells[1].className).not.toContain('line-through')
  })

  test('leaves the discount cell empty at exactly list price', () => {
    renderRows([
      {
        key: 'input',
        labelKey: 'Input',
        platform: '$15',
        official: '$15',
        discountRatio: 1,
      },
    ])

    const cells = within(rowFor('Input')).getAllByRole('cell')
    expect(cells[2]).toHaveTextContent('-')
    expect(cells[1].className).not.toContain('line-through')
  })

  test('still renders the pill for a real discount', () => {
    renderRows([
      {
        key: 'input',
        labelKey: 'Input',
        platform: '$6.6',
        official: '$15',
        discountRatio: 0.44,
      },
    ])

    const cells = within(rowFor('Input')).getAllByRole('cell')
    // The test env runs the English catalog; the same ratio reads "4.4折" under
    // `zh`, pinned in discount-locale.test.ts.
    expect(cells[2]).toHaveTextContent('56% off')
    expect(cells[1].className).toContain('line-through')
  })
})
