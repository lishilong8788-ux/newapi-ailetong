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

import { parseChannelEcho } from '../api'

/**
 * Reading the channel trio off a non-streaming reply, as axios exposes it.
 *
 * The backend half of this is still being built, so "the headers are not there"
 * is a state this has to handle correctly today rather than a hypothetical.
 */
describe('parsing the channel echo from response headers', () => {
  test('reads id, code and a honoured pin', () => {
    expect(
      parseChannelEcho({
        'x-new-api-channel-id': '12',
        'x-new-api-channel-code': 'hs4',
        'x-new-api-channel-pinned': '1',
      })
    ).toEqual({ id: 12, code: 'hs4', pinned: true })
  })

  // The distinction the whole feature rests on: a pin that fell through to
  // another line must not be indistinguishable from one that held.
  test('marks a router-chosen channel as not pinned', () => {
    expect(
      parseChannelEcho({
        'x-new-api-channel-id': '7',
        'x-new-api-channel-code': 'az2',
        'x-new-api-channel-pinned': '0',
      })
    ).toEqual({ id: 7, code: 'az2', pinned: false })
  })

  test('treats a missing pin header as not pinned', () => {
    expect(parseChannelEcho({ 'x-new-api-channel-id': '7' })).toEqual({
      id: 7,
      pinned: false,
    })
  })

  // A channel whose model mapping carries no suffix has no code; the display
  // falls back to `#id` rather than showing an empty label.
  test('omits the code when it is absent or blank', () => {
    expect(
      parseChannelEcho({
        'x-new-api-channel-id': '12',
        'x-new-api-channel-code': '   ',
      })
    ).toEqual({ id: 12, pinned: false })
  })

  test('accepts header names in any case', () => {
    expect(
      parseChannelEcho({
        'X-New-Api-Channel-Id': '12',
        'X-New-Api-Channel-Pinned': '1',
      })
    ).toEqual({ id: 12, pinned: true })
  })

  test.each([
    ['no headers at all', {}],
    ['a missing id', { 'x-new-api-channel-code': 'hs4' }],
    ['a non-numeric id', { 'x-new-api-channel-id': 'abc' }],
    ['a zero id', { 'x-new-api-channel-id': '0' }],
    ['a negative id', { 'x-new-api-channel-id': '-3' }],
    ['a fractional id', { 'x-new-api-channel-id': '1.5' }],
    ['an empty id', { 'x-new-api-channel-id': '' }],
  ])('reports an unknown channel for %s', (_case, headers) => {
    expect(parseChannelEcho(headers)).toBeUndefined()
  })
})
