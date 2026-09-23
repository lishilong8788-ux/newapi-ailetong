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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

// The section reads vendor list prices off the shared pricing endpoint. Stubbed
// so the computed columns are asserted against a known baseline rather than
// whatever the catalog happens to hold.
vi.mock('@/features/pricing/api', () => ({
  getPricing: vi.fn(async () => ({
    data: [
      {
        model_name: 'deepseek-v4.1',
        quota_type: 0,
        model_ratio: 1,
        completion_ratio: 1,
        official_model_ratio: 1.99 / 2,
        official_completion_ratio: 7.99 / 1.99,
        enable_groups: ['default'],
      },
    ],
  })),
}))

const { useForm } = await import('react-hook-form')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { Form } = await import('@/components/ui/form')
const { CHANNEL_FORM_DEFAULT_VALUES } = await import('../../../../lib')
const { ChannelPricingSection } = await import('../channel-pricing-section')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        '{{percent}}% off': '{{percent}}% off',
        '{{count}} not priced': '{{count}} not priced',
      },
    },
  },
})

function Harness(props: {
  markupPercent?: number
  models?: Array<{
    model: string
    input?: number
    output?: number
    markup_percent?: number
  }>
  upstreamModels?: string[]
}) {
  const form = useForm({
    defaultValues: {
      ...CHANNEL_FORM_DEFAULT_VALUES,
      cost_markup_percent: props.markupPercent ?? 30,
      cost_models: props.models ?? [],
    },
  })

  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <I18nextProvider i18n={i18n}>
        <Form {...form}>
          <ChannelPricingSection
            form={form as never}
            modelOptions={[{ value: 'deepseek-v4.1', label: 'deepseek-v4.1' }]}
            upstreamModels={props.upstreamModels}
            enabled
          />
        </Form>
      </I18nextProvider>
    </QueryClientProvider>
  )
}

describe('channel pricing table', () => {
  test('derives sell price and margin from the typed buy price', async () => {
    render(
      <Harness
        markupPercent={30}
        models={[{ model: 'deepseek-v4.1', input: 0.49, output: 1.96 }]}
      />
    )

    // 0.49 × 1.3 = 0.637, 1.96 × 1.3 = 2.548
    expect(await screen.findByText('$0.637')).toBeInTheDocument()
    expect(screen.getByText('$2.548')).toBeInTheDocument()
    // The markup the operator typed, restated as the margin the cost report
    // grades them on: 0.3 / 1.3.
    expect(screen.getByText('23.1%')).toBeInTheDocument()
  })

  test('the buy price and markup cells are the only inputs on a row', () => {
    render(
      <Harness models={[{ model: 'deepseek-v4.1', input: 1, output: 2 }]} />
    )

    // Sell price, official price and discount are text, not fields.
    expect(screen.getByLabelText('Buy price (input)')).toBeInTheDocument()
    expect(screen.getByLabelText('Buy price (output)')).toBeInTheDocument()
    // Two buy prices + the row markup + the channel markup.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(4)
  })

  test('a blank row markup inherits the channel one; typing overrides it', () => {
    render(
      <Harness
        markupPercent={30}
        models={[{ model: 'deepseek-v4.1', input: 1, output: 2 }]}
      />
    )

    const override = screen.getByLabelText('Override markup')
    // Empty with the channel value as its placeholder: the box shows what it
    // will inherit, and typing over it is the whole override gesture.
    expect(override).toHaveValue(null)
    expect(override).toHaveAttribute('placeholder', '30')
    expect(screen.getByText('$1.3')).toBeInTheDocument()
    expect(screen.getByText('$2.6')).toBeInTheDocument()

    fireEvent.change(override, { target: { value: '50' } })
    expect(screen.getByText('$1.5')).toBeInTheDocument()
    expect(screen.getByText('$3')).toBeInTheDocument()

    // Reverting empties the box again rather than pinning the last number.
    fireEvent.click(screen.getByRole('button', { name: 'Use channel markup' }))
    expect(screen.getByLabelText('Override markup')).toHaveValue(null)
    expect(screen.getByText('$1.3')).toBeInTheDocument()
    expect(screen.getByText('$2.6')).toBeInTheDocument()
  })

  test('a row with no buy price shows no sell price or discount', () => {
    render(<Harness models={[{ model: 'deepseek-v4.1' }]} />)

    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(2)
  })

  test('unpriced upstream models are offered for one-click import', () => {
    render(
      <Harness
        models={[{ model: 'deepseek-v4.1', input: 1 }]}
        upstreamModels={['deepseek-v4.1', 'deepseek-v4.1-flash']}
      />
    )

    // Coverage counts priced rows against what the channel actually requests.
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByText('1 not priced')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /Import channel models/ })
    )

    // The missing model is appended as a row rather than silently priced.
    expect(screen.getAllByLabelText('Buy price (input)')).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: /Import channel models/ })
    ).not.toBeInTheDocument()
  })

  test('the empty table states why a buy price is needed', () => {
    render(<Harness models={[]} />)

    expect(screen.getByText('No model priced yet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buy price (input)')).not.toBeInTheDocument()
  })

  test('the row under the last one appends, and hides while searching', () => {
    // Six rows: the search box only appears once the list is long enough to
    // need one, and this test needs to type into it.
    render(
      <Harness
        models={Array.from({ length: 6 }, (_, i) => ({
          model: `deepseek-v4.${i}`,
          input: 1,
        }))}
      />
    )

    // Two ways in by design: the header button and the dashed row that fills
    // the space under the list. Both append the same blank row.
    const rowAppend = screen.getAllByRole('button', { name: 'Add model' })
    expect(rowAppend.length).toBeGreaterThanOrEqual(2)

    const dashedRow = rowAppend.at(-1)
    expect(dashedRow).toBeDefined()
    fireEvent.click(dashedRow as HTMLElement)
    expect(screen.getAllByLabelText('Buy price (input)')).toHaveLength(7)

    // A filtered list has no meaningful end to append to, so the row goes away
    // and only the header button remains.
    fireEvent.change(screen.getByLabelText('Search models...'), {
      target: { value: 'deepseek' },
    })
    expect(screen.getAllByRole('button', { name: 'Add model' })).toHaveLength(1)
  })
})
