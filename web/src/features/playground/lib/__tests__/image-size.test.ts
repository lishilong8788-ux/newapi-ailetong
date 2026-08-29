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

import { resolveImageSize } from '../parameters/image-size'

describe('resolveImageSize', () => {
  test.each([
    ['1:1', '1024x1024'],
    ['3:2', '1280x853'],
    ['2:3', '853x1280'],
    ['16:9', '1280x720'],
    ['9:16', '720x1280'],
  ])('maps the %s ratio to %s', (ratio, expected) => {
    expect(resolveImageSize({ aspect_ratio: ratio })).toBe(expected)
  })

  /**
   * The contract that matters: never return an empty size. A request without one
   * is rejected by channels that bill per resolution tier, so an unset, adaptive
   * or unrecognised ratio still has to produce a concrete pixel size.
   */
  test.each([
    ['an unset chip', {}],
    ['the adaptive option', { aspect_ratio: 'auto' }],
    ['a ratio outside the table', { aspect_ratio: '21:9' }],
    ['an empty string', { aspect_ratio: '' }],
  ])('falls back to the square 1K size for %s', (_label, values) => {
    expect(resolveImageSize(values)).toBe('1024x1024')
  })

  test('ignores chips belonging to other parameters', () => {
    expect(resolveImageSize({ count: '4' })).toBe('1024x1024')
  })
})
