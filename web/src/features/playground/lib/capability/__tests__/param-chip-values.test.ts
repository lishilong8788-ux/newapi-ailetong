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
// Lives under `lib/capability/__tests__` on purpose: `vitest.node.config.ts`
// only globs that directory, so a test placed next to the module it covers
// (`lib/parameters/`) would silently never run. See the playground handoff doc.
import { describe, expect, test } from 'vitest'

import {
  getChipDefaultValue,
  getChipValue,
  getChipValueLabel,
  isChipModified,
  normalizeChipCustomValue,
} from '../../parameters/param-chip-values'
import type { ParamChipSpec } from '../types'

const COUNT_CHIP: ParamChipSpec = {
  id: 'count',
  icon: 'Layers',
  label: 'Count',
  options: [
    { value: '1', label: '1 image' },
    { value: '2', label: '2 images' },
    { value: '4', label: '4 images' },
  ],
  customInput: true,
}

const ADVANCED_CHIP: ParamChipSpec = {
  id: 'advanced',
  icon: 'SlidersHorizontal',
  label: 'Advanced settings',
}

describe('param chip values', () => {
  test('defaults to the first option', () => {
    expect(getChipDefaultValue(COUNT_CHIP)).toBe('1')
    expect(getChipValue(COUNT_CHIP, {})).toBe('1')
  })

  test('a chip with no options has no default', () => {
    expect(getChipDefaultValue(ADVANCED_CHIP)).toBeUndefined()
    expect(getChipValue(ADVANCED_CHIP, {})).toBeUndefined()
  })

  test('a stored value overrides the default', () => {
    expect(getChipValue(COUNT_CHIP, { count: '2' })).toBe('2')
  })

  test('the face label comes from the matching option', () => {
    expect(getChipValueLabel(COUNT_CHIP, { count: '2' })).toBe('2 images')
  })

  test('a custom value with no matching option shows as itself', () => {
    // Otherwise the user types 3 and the chip reads "1 image", which looks like
    // the input was dropped.
    expect(getChipValueLabel(COUNT_CHIP, { count: '3' })).toBe('3')
  })

  test('only a non-default value counts as modified', () => {
    expect(isChipModified(COUNT_CHIP, {})).toBe(false)
    expect(isChipModified(COUNT_CHIP, { count: '1' })).toBe(false)
    expect(isChipModified(COUNT_CHIP, { count: '4' })).toBe(true)
  })
})

describe('normalizeChipCustomValue', () => {
  test('accepts a positive number and normalises it', () => {
    expect(normalizeChipCustomValue('3')).toBe('3')
    expect(normalizeChipCustomValue('  3 ')).toBe('3')
    expect(normalizeChipCustomValue('03')).toBe('3')
    expect(normalizeChipCustomValue('1.5')).toBe('1.5')
  })

  test('rejects blank, non-numeric, zero and negative input', () => {
    for (const input of ['', '   ', 'abc', '0', '-2', 'NaN', 'Infinity']) {
      expect(normalizeChipCustomValue(input), input).toBeNull()
    }
  })
})
