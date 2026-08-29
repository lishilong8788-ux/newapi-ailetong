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
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars
        ? key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ''))
        : key,
  }),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { price: 1, usd_exchange_rate: 1 } }),
}))

import type { PricingModel } from '@/features/pricing/types'

import type { ModelOption } from '../../../types'
import { ModelPriceNote } from '../model-price-note'

function tokenModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'gpt-4o',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 4,
    enable_groups: ['default'],
    ...overrides,
  } as PricingModel
}

function option(pricing?: PricingModel): ModelOption {
  return { label: 'gpt-4o', value: 'gpt-4o', pricing }
}

describe('ModelPriceNote', () => {
  it('quotes input and output separately for token-billed models', () => {
    render(
      <ModelPriceNote
        groupValue='default'
        selectedModel={option(tokenModel())}
      />
    )

    // model_ratio 1 * 2 = $2/1M in, * completion_ratio 4 = $8/1M out.
    expect(screen.getByText(/in \//)).toHaveTextContent('2')
    expect(screen.getByText(/in \//)).toHaveTextContent('8')
  })

  it('falls back when the model has no catalog entry', () => {
    render(
      <ModelPriceNote
        fallback={<span>Billed per token</span>}
        groupValue='default'
        selectedModel={option(undefined)}
      />
    )

    expect(screen.getByText('Billed per token')).toBeInTheDocument()
  })

  it('falls back for request-billed models with no price set', () => {
    render(
      <ModelPriceNote
        fallback={<span>Billed per request</span>}
        groupValue='default'
        selectedModel={option(tokenModel({ quota_type: 1, model_price: 0 }))}
      />
    )

    expect(screen.getByText('Billed per request')).toBeInTheDocument()
  })

  it('renders nothing when unquotable and no fallback is given', () => {
    const { container } = render(
      <ModelPriceNote groupValue='default' selectedModel={option(undefined)} />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
