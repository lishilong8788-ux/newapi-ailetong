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

import {
  PRICING_CARD_GRID_COLUMNS_CLASS,
  PRICING_FILTER_SCALE,
  PRICING_SHELL_COLUMNS_CLASS,
} from '../constants'

/** Tailwind's default type scale, for the named steps this feature uses. */
const NAMED_TEXT_SIZES_PX: Record<string, number> = {
  'text-xs': 12,
  'text-sm': 14,
  'text-base': 16,
}

function textSizePx(token: string): number {
  const arbitrary = /^text-\[(\d+)px\]$/.exec(token)
  if (arbitrary) return Number(arbitrary[1])

  const named = NAMED_TEXT_SIZES_PX[token]
  if (named === undefined) {
    throw new Error(`unhandled text size token: ${token}`)
  }
  return named
}

const RAIL_WIDTH_PATTERN = /grid-cols-\[(\d+)px_minmax\(0,1fr\)\]/g

function railWidths(template: string): number[] {
  return [...template.matchAll(RAIL_WIDTH_PATTERN)].map((match) =>
    Number(match[1])
  )
}

describe('pricing shell columns', () => {
  test('gives the filter rail at least 272px at every width it is visible', () => {
    const widths = railWidths(PRICING_SHELL_COLUMNS_CLASS)

    expect(widths.length).toBeGreaterThan(0)
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(272)
    }
  })

  test('never narrows the rail as the viewport grows', () => {
    const widths = railWidths(PRICING_SHELL_COLUMNS_CLASS)

    expect([...widths].sort((a, b) => a - b)).toEqual(widths)
  })

  test('keeps the content column fluid so it absorbs all remaining width', () => {
    const columnClasses = PRICING_SHELL_COLUMNS_CLASS.split(' ')

    for (const columnClass of columnClasses) {
      expect(columnClass).toContain('minmax(0,1fr)')
    }
  })

  test('caps neither column, so the shell can run edge to edge', () => {
    expect(PRICING_SHELL_COLUMNS_CLASS).not.toContain('max-w-')
  })
})

describe('pricing filter scale', () => {
  test('orders the rail type scale from panel title down to chip badge', () => {
    const sizes = [
      PRICING_FILTER_SCALE.panelTitle,
      PRICING_FILTER_SCALE.sectionTitle,
      PRICING_FILTER_SCALE.chipLabel,
      PRICING_FILTER_SCALE.chipBadge,
    ].map(textSizePx)

    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    expect(new Set(sizes).size).toBe(sizes.length)
  })

  test('keeps chip labels above the 12px default so the rail is not fine print', () => {
    expect(textSizePx(PRICING_FILTER_SCALE.chipLabel)).toBeGreaterThan(
      NAMED_TEXT_SIZES_PX['text-xs']
    )
  })

  test('renders vendor marks large enough to identify at a glance', () => {
    expect(PRICING_FILTER_SCALE.chipIconSize).toBeGreaterThanOrEqual(16)
  })

  test('leaves the vendor mark taller than the chip label it sits beside', () => {
    expect(PRICING_FILTER_SCALE.chipIconSize).toBeGreaterThan(
      textSizePx(PRICING_FILTER_SCALE.chipLabel)
    )
  })
})

describe('pricing card grid columns', () => {
  test('adds a fifth column past 1900px so cards stop stretching', () => {
    expect(PRICING_CARD_GRID_COLUMNS_CLASS).toContain(
      'min-[1900px]:grid-cols-5'
    )
  })

  test('steps column count up monotonically across breakpoints', () => {
    const counts = [
      ...PRICING_CARD_GRID_COLUMNS_CLASS.matchAll(/grid-cols-(\d+)/g),
    ].map((match) => Number(match[1]))

    expect(counts).toEqual([1, 2, 3, 4, 5])
  })
})
