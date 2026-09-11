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
  formatCommissionAmount,
  formatCommissionRate,
  maskBankAccount,
} from '../format'

describe('formatCommissionAmount', () => {
  test.each([
    [0, '¥0.00'],
    [1200, '¥1,200.00'],
    [4820.5, '¥4,820.50'],
    // A reversal or clawback: the sign leads the symbol so the direction is
    // readable before the digits are.
    [-120.5, '-¥120.50'],
    [1_234_567.89, '¥1,234,567.89'],
  ])('renders %s as %s', (input, expected) => {
    expect(formatCommissionAmount(input)).toBe(expected)
  })

  test('always shows two decimals so a column of amounts aligns', () => {
    expect(formatCommissionAmount(5)).toBe('¥5.00')
    expect(formatCommissionAmount(5.1)).toBe('¥5.10')
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('renders a dash for %s rather than a bogus figure', (_label, input) => {
    expect(formatCommissionAmount(input)).toBe('—')
  })
})

describe('formatCommissionRate', () => {
  test.each([
    [0.05, '5%'],
    [0.08, '8%'],
    [0.125, '12.50%'],
    // An explicit zero is a real decision — no commission at all — and must not
    // be mistaken for an absent override.
    [0, '0%'],
    [1, '100%'],
  ])('renders %s as %s', (input, expected) => {
    expect(formatCommissionRate(input)).toBe(expected)
  })

  test('returns null for an absent override so the caller can translate it', () => {
    // Not a hardcoded dash: "follow the global default" is a distinct state that
    // needs its own localized label.
    expect(formatCommissionRate(null)).toBeNull()
    expect(formatCommissionRate(undefined)).toBeNull()
  })
})

describe('maskBankAccount', () => {
  test('keeps only the last four digits of a full account number', () => {
    expect(maskBankAccount('6222021234567890123')).toBe('••••0123')
  })

  test('is idempotent, so a pre-masked value is not masked twice', () => {
    // The server already masks the list and the export. Re-masking the asterisks
    // would leave no digits at all and destroy the only identifying detail.
    expect(maskBankAccount('****0123')).toBe('••••0123')
    expect(maskBankAccount('••••0123')).toBe('••••0123')
  })

  test('ignores separators when picking the visible digits', () => {
    expect(maskBankAccount('6222 0212 3456 7890 123')).toBe('••••0123')
  })

  test('still masks an account shorter than the visible window', () => {
    expect(maskBankAccount('123')).toBe('••••123')
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('renders a dash for %s', (_label, input) => {
    expect(maskBankAccount(input)).toBe('—')
  })
})
