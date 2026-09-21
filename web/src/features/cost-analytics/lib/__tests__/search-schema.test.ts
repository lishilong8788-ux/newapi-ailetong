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

import { DEFAULT_WINDOW_DAYS } from '../../constants'
import { costAnalyticsSearchSchema } from '../../search'

/**
 * `validateSearch` runs before the route has a component, so a throw here is not
 * a page error — it unwinds to the root boundary and replaces the whole app with
 * the error page. Every field must therefore fall back rather than reject.
 */
describe('cost analytics URL contract', () => {
  test('keeps a well-formed window and tab', () => {
    expect(costAnalyticsSearchSchema.parse({ days: 7, tab: 'models' })).toEqual(
      {
        days: 7,
        tab: 'models',
      }
    )
  })

  test('falls back to the default window instead of throwing', () => {
    // What `?days=abc` and `?days=` reach the schema as: the search parser only
    // produces a number when the raw value parses as one.
    expect(costAnalyticsSearchSchema.parse({ days: 'abc' })).toEqual({
      days: DEFAULT_WINDOW_DAYS,
    })
    expect(costAnalyticsSearchSchema.parse({ days: '' })).toEqual({
      days: DEFAULT_WINDOW_DAYS,
    })
    expect(costAnalyticsSearchSchema.parse({ days: null })).toEqual({
      days: DEFAULT_WINDOW_DAYS,
    })
  })

  test('falls back on a malformed tab while keeping a valid window', () => {
    expect(costAnalyticsSearchSchema.parse({ days: 90, tab: 42 })).toEqual({
      days: 90,
      tab: 'overview',
    })
  })

  test('an absent window stays absent — the page owns that default', () => {
    expect(costAnalyticsSearchSchema.parse({})).toEqual({})
  })
})
