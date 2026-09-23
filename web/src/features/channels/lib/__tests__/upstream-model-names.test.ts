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

import { resolveUpstreamModelNames } from '../model-mapping-validation'

// Channel cost is keyed by the name the relay sends upstream, so these are the
// keys the pricing table has to offer. Mirrors the backend's
// ResolveMappedModelName; a divergence here prices models under names billing
// never looks up.
describe('upstream model names behind a channel', () => {
  test('passes published names through when nothing is remapped', () => {
    expect(resolveUpstreamModelNames(['gpt-4o', 'o3'], '')).toEqual([
      'gpt-4o',
      'o3',
    ])
    expect(resolveUpstreamModelNames(['gpt-4o'], '{}')).toEqual(['gpt-4o'])
  })

  test('follows a redirect chain to the name the vendor invoices', () => {
    const mapping = JSON.stringify({
      'gpt-4o': 'gpt-4o-2024-11-20',
      'gpt-4o-2024-11-20': 'gpt-4o-final',
    })

    expect(resolveUpstreamModelNames(['gpt-4o'], mapping)).toEqual([
      'gpt-4o-final',
    ])
  })

  test('stops at a self-map instead of treating it as a cycle', () => {
    const mapping = JSON.stringify({ 'gpt-4o': 'gpt-4o' })

    expect(resolveUpstreamModelNames(['gpt-4o'], mapping)).toEqual(['gpt-4o'])
  })

  test('keeps the published name when the mapping cycles', () => {
    const mapping = JSON.stringify({ a: 'b', b: 'a' })

    // The backend refuses a cyclic mapping and the request keeps its client
    // name, so offering 'b' as a cost key here would be a lie.
    expect(resolveUpstreamModelNames(['a'], mapping)).toEqual(['a'])
  })

  test('collapses models that remap onto the same upstream name', () => {
    const mapping = JSON.stringify({
      'gpt-4o': 'shared-upstream',
      'gpt-4o-mini': 'shared-upstream',
    })

    expect(
      resolveUpstreamModelNames(['gpt-4o', 'gpt-4o-mini'], mapping)
    ).toEqual(['shared-upstream'])
  })

  test('ignores blank entries and unparsable mappings', () => {
    expect(
      resolveUpstreamModelNames([' gpt-4o ', '', '  '], 'not json')
    ).toEqual(['gpt-4o'])
  })
})
