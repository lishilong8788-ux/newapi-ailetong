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
import { describe, expect, it } from 'vitest'

import {
  hasAdvancedSettingsErrors,
  hasPricingErrors,
  resolveChannelEditorErrorTab,
} from '../channel-form-errors'

// The channel editor keeps only the active tab mounted, so a rejected field on
// a hidden tab renders no message of its own. Routing the submit failure to the
// owning tab is the only thing that puts the invalid input back on screen.
describe('resolveChannelEditorErrorTab', () => {
  const cases: Array<{
    name: string
    errors: Record<string, unknown>
    expected: 'basics' | 'pricing' | 'advanced'
  }> = [
    {
      name: 'identity field stays on basics',
      errors: { name: {} },
      expected: 'basics',
    },
    {
      name: 'credential field stays on basics',
      errors: { key: {} },
      expected: 'basics',
    },
    {
      name: 'models field stays on basics',
      errors: { models: {} },
      expected: 'basics',
    },
    {
      name: 'markup percent opens pricing',
      errors: { cost_markup_percent: {} },
      expected: 'pricing',
    },
    {
      name: 'per-model buy price opens pricing',
      errors: { cost_models: {} },
      expected: 'pricing',
    },
    {
      name: 'raw pricing JSON opens pricing',
      errors: { cost_json: {} },
      expected: 'pricing',
    },
    {
      name: 'override rule opens advanced',
      errors: { param_override: {} },
      expected: 'advanced',
    },
    {
      name: 'routing weight opens advanced',
      errors: { weight: {} },
      expected: 'advanced',
    },
    {
      name: 'basics wins over pricing and advanced together',
      errors: { name: {}, cost_models: {}, param_override: {} },
      expected: 'basics',
    },
    {
      name: 'pricing wins over advanced',
      errors: { cost_json: {}, proxy: {} },
      expected: 'pricing',
    },
    {
      name: 'no errors falls back to basics',
      errors: {},
      expected: 'basics',
    },
  ]

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(resolveChannelEditorErrorTab(testCase.errors)).toBe(
        testCase.expected
      )
    })
  }
})

// Pricing moved out of the advanced section into its own tab, so the two
// predicates that drive the tab status glyphs must no longer overlap.
describe('pricing and advanced error partition', () => {
  it('classifies pricing fields as pricing only', () => {
    const errors = { cost_markup_percent: {}, cost_models: {}, cost_json: {} }
    expect(hasPricingErrors(errors)).toBe(true)
    expect(hasAdvancedSettingsErrors(errors)).toBe(false)
  })

  it('classifies advanced fields as advanced only', () => {
    const errors = { param_override: {}, status_code_mapping: {} }
    expect(hasAdvancedSettingsErrors(errors)).toBe(true)
    expect(hasPricingErrors(errors)).toBe(false)
  })

  it('ignores basics fields in both', () => {
    const errors = { name: {}, key: {}, models: {} }
    expect(hasAdvancedSettingsErrors(errors)).toBe(false)
    expect(hasPricingErrors(errors)).toBe(false)
  })
})
