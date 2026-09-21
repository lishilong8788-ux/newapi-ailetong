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
import { describe, expect, it, beforeEach } from 'vitest'

import {
  getBillingCurrencyLabel,
  getBillingCurrencySymbol,
} from '@/lib/currency'
import {
  useSystemConfigStore,
  DEFAULT_CURRENCY_CONFIG,
} from '@/stores/system-config-store'

describe('currency billing helpers', () => {
  beforeEach(() => {
    useSystemConfigStore.setState({
      config: {
        systemName: 'Test System',
        logo: '',
        currency: { ...DEFAULT_CURRENCY_CONFIG },
      },
    })
  })

  it('returns $ and USD for default config', () => {
    expect(getBillingCurrencySymbol()).toBe('$')
    expect(getBillingCurrencyLabel()).toBe('USD')
  })

  it('returns ¥ and CNY when quotaDisplayType is CNY', () => {
    useSystemConfigStore.setState({
      config: {
        systemName: 'Test System',
        logo: '',
        currency: {
          ...DEFAULT_CURRENCY_CONFIG,
          quotaDisplayType: 'CNY',
          usdExchangeRate: 7.0,
        },
      },
    })

    expect(getBillingCurrencySymbol()).toBe('¥')
    expect(getBillingCurrencyLabel()).toBe('CNY')
  })

  it('returns custom symbol when quotaDisplayType is CUSTOM', () => {
    useSystemConfigStore.setState({
      config: {
        systemName: 'Test System',
        logo: '',
        currency: {
          ...DEFAULT_CURRENCY_CONFIG,
          quotaDisplayType: 'CUSTOM',
          customCurrencySymbol: '€',
          customCurrencyExchangeRate: 0.9,
        },
      },
    })

    expect(getBillingCurrencySymbol()).toBe('€')
    expect(getBillingCurrencyLabel()).toBe('€')
  })

  it('returns $ and USD when quotaDisplayType is TOKENS', () => {
    useSystemConfigStore.setState({
      config: {
        systemName: 'Test System',
        logo: '',
        currency: {
          ...DEFAULT_CURRENCY_CONFIG,
          quotaDisplayType: 'TOKENS',
        },
      },
    })

    expect(getBillingCurrencySymbol()).toBe('$')
    expect(getBillingCurrencyLabel()).toBe('USD')
  })
})
