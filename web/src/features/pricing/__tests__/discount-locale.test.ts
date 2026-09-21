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
import i18next from 'i18next'
import { beforeAll, describe, expect, test } from 'vitest'

import { formatDiscount } from '@/lib/format'

import en from '../../../i18n/locales/en.json'
import zh from '../../../i18n/locales/zh.json'

// The shared test setup initialises i18next with an empty catalog, so every key
// passes through as its own name. That is fine for asserting structure but it
// cannot show what a discount actually reads like — and the two catalogues use
// DIFFERENT interpolation variables for the same key: English substitutes
// `{{percent}}`, Chinese substitutes `{{tenths}}`. A rounding change that broke
// "1.3折" into "1.28折" would be invisible against an empty catalog.
//
// So this suite loads both real catalogues and pins the rendered strings.

let translateZh: (key: string, options?: Record<string, unknown>) => string
let translateEn: (key: string, options?: Record<string, unknown>) => string

beforeAll(async () => {
  const instance = i18next.createInstance()
  await instance.init({
    lng: 'zh',
    fallbackLng: 'en',
    resources: {
      zh: { translation: zh.translation },
      en: { translation: en.translation },
    },
    interpolation: { escapeValue: false },
  })
  translateZh = instance.getFixedT('zh')
  translateEn = instance.getFixedT('en')
})

describe('discount rendering against the real catalogues', () => {
  test('renders tenths with a single decimal in Chinese', () => {
    // The worked example from the spec: platform $1.92 vs official $15.
    expect(formatDiscount(0.13, translateZh)).toBe('1.3折')
    expect(formatDiscount(0.44, translateZh)).toBe('4.4折')
    // A whole tenth reads without a trailing zero — "4折", not "4.0折".
    expect(formatDiscount(0.4, translateZh)).toBe('4折')
  })

  test('renders the complement as a percentage in English', () => {
    expect(formatDiscount(0.13, translateEn)).toBe('87% off')
    expect(formatDiscount(0.4, translateEn)).toBe('60% off')
  })

  test('refuses a ratio that is not a discount, in either convention', () => {
    // The live row that prompted this: a channel pricing cached reads at ¥0.678
    // against a ¥0.3 vendor rate. Neither catalogue could state it — zh printed
    // "22.6折", off the end of a scale that stops at 10, and en printed
    // "-126% off", which advertises the markup. The markup is real, but it is not
    // a discount, so there is no discount string to render.
    expect(formatDiscount(2.26, translateZh)).toBeNull()
    expect(formatDiscount(2.26, translateEn)).toBeNull()

    // Exactly 1 is the boundary and it is on the null side: paying list price is
    // not a saving. "10折" and "0% off" are both true and both worthless.
    expect(formatDiscount(1, translateZh)).toBeNull()
    expect(formatDiscount(1, translateEn)).toBeNull()

    // Just inside the boundary still renders, so the guard cannot quietly widen
    // into real discounts.
    expect(formatDiscount(0.99, translateZh)).toBe('9.9折')
    expect(formatDiscount(0.99, translateEn)).toBe('1% off')
  })

  test('every key the official price sync adds is translated in Chinese', () => {
    // These are typed straight into the catalogues by hand (`i18n:sync` only
    // back-fills from English), so a missed paste shows up as English text on a
    // Chinese admin page rather than as a build failure.
    const keys = [
      'Official price',
      'Official price sync',
      'Platform price vs. official price',
      'Last synced: {{time}}',
      'Never synced',
      'Sync official prices now',
      'Daily auto sync',
      'Refresh official prices once a day in the background.',
      'Failed to sync official prices',
      'Some sources failed: {{errorMsg}}',
      'Official prices synced for {{count}} models',
    ]
    const catalog = zh.translation as Record<string, string>
    for (const key of keys) {
      expect(catalog[key], `zh.json is missing "${key}"`).toBeTruthy()
      expect(catalog[key], `"${key}" is still English in zh.json`).not.toBe(key)
    }
  })
})
