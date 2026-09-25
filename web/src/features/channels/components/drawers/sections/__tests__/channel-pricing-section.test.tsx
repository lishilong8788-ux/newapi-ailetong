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
        'margin {{rate}}': 'margin {{rate}}',
        'Buy price ({{kind}})': 'Buy price ({{kind}})',
        'Margin on this model: {{margin}}. Blank dimensions are not charged.':
          'Margin on this model: {{margin}}.',
        '{{count}} per-token price(s) are kept but ignored while a per-request price is set.':
          '{{count}} per-token price(s) are kept but ignored.',
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
    cache_read?: number
    image_out?: number
    audio_in?: number
    per_call?: number
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

/** Clicks a rail entry by the model name it prints. */
function selectModel(name: string) {
  const entry = screen.getByText(name).closest('button')
  expect(entry).not.toBeNull()
  fireEvent.click(entry as HTMLElement)
}

describe('model price sheet', () => {
  test('shows every per-token dimension on one sheet, with no expander', () => {
    render(
      <Harness
        models={[{ model: 'deepseek-v4.1', input: 0.49, output: 1.96 }]}
      />
    )

    // The three that used to be the only visible ones sit in the same sheet as
    // the seven that used to be hidden behind a per-row expander.
    for (const kind of [
      'Input',
      'Output',
      'Cache read',
      'Reasoning',
      'Cache write (5m)',
      'Cache write (1h)',
      'Image input',
      'Image output',
      'Audio input',
      'Audio output',
    ]) {
      expect(screen.getByLabelText(`Buy price (${kind})`)).toBeInTheDocument()
    }

    // 10 per-token kinds + the row markup + the channel markup. Per-request is
    // a mode, so its box is not on the sheet until the mode is picked.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(12)
    expect(screen.queryByLabelText('Buy price (Per request)')).toBeNull()
  })

  test('derives the sell price of each dimension from its own buy price', async () => {
    render(
      <Harness
        markupPercent={20}
        models={[
          { model: 'deepseek-v4.1', input: 1, output: 4, cache_read: 0.02 },
        ]}
      />
    )

    // Every kind is marked up by the same 20%: 1 → 1.2, 4 → 4.8, 0.02 → 0.024.
    expect(await screen.findByText('$1.2')).toBeInTheDocument()
    expect(screen.getByText('$4.8')).toBeInTheDocument()
    expect(screen.getByText('$0.024')).toBeInTheDocument()
    // The markup restated as the margin the cost report grades them on.
    expect(screen.getByText('Margin on this model: 16.7%.')).toBeInTheDocument()
  })

  test('a cost-only dimension shows no sell price, since it bills at the output rate', () => {
    render(
      <Harness
        markupPercent={30}
        models={[{ model: 'deepseek-v4.1', input: 1, image_out: 10 }]}
      />
    )

    // Two kinds have no ratio of their own: image output and reasoning.
    expect(screen.getAllByText('Cost only')).toHaveLength(2)
    // 10 × 1.3 = 13 would be a charge the backend cannot make.
    expect(screen.queryByText('$13')).toBeNull()
    expect(screen.getByText('$1.3')).toBeInTheDocument()
  })

  test('a blank row markup follows the channel one; typing overrides it', () => {
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
    expect(screen.getByText('follows channel')).toBeInTheDocument()
    expect(screen.getByText('$1.3')).toBeInTheDocument()

    fireEvent.change(override, { target: { value: '50' } })
    expect(screen.getByText('$1.5')).toBeInTheDocument()
    expect(screen.getByText('$3')).toBeInTheDocument()

    // Reverting empties the box again rather than pinning the last number.
    fireEvent.click(screen.getByRole('button', { name: 'Use channel markup' }))
    expect(screen.getByLabelText('Override markup')).toHaveValue(null)
    expect(screen.getByText('$1.3')).toBeInTheDocument()
  })

  test('a row with no buy price shows no sell price or discount', async () => {
    render(<Harness models={[{ model: 'deepseek-v4.1' }]} />)

    expect(await screen.findByText('Not priced')).toBeInTheDocument()
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(2)
  })
})

describe('billing mode', () => {
  test('a saved per-request price opens the sheet in per-request mode', () => {
    render(
      <Harness
        models={[{ model: 'deepseek-v4.1', input: 1, per_call: 0.004 }]}
      />
    )

    // resolveModelCostExact and ResolveSellPrice both take the per_call branch
    // first, so no per-token box is offered while it is set.
    expect(
      screen.getByRole('button', { name: 'Per request', pressed: true })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Buy price (Per request)')).toBeEnabled()
    expect(screen.queryByLabelText('Buy price (Input)')).toBeNull()
    // The parked token price is reported rather than silently dropped.
    expect(
      screen.getByText('1 per-token price(s) are kept but ignored.')
    ).toBeInTheDocument()
  })

  test('switching back to per-token clears the per-request price', () => {
    render(
      <Harness
        models={[{ model: 'deepseek-v4.1', input: 1, per_call: 0.004 }]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Per token' }))

    // Left in place, the backend would keep taking the per_call branch while
    // the sheet shows token prices.
    expect(screen.getByLabelText('Buy price (Input)')).toHaveValue(1)
    fireEvent.click(screen.getByRole('button', { name: 'Per request' }))
    expect(screen.getByLabelText('Buy price (Per request)')).toHaveValue(null)
  })

  test('picking per-request mode holds before a price is typed', () => {
    render(<Harness models={[{ model: 'deepseek-v4.1', input: 1 }]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Per request' }))

    // An empty per_call field reads as per-token mode, so the toggle would snap
    // back the instant it was clicked if the choice were derived from data only.
    expect(screen.getByLabelText('Buy price (Per request)')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Per request', pressed: true })
    ).toBeInTheDocument()
  })
})

describe('model rail', () => {
  test('the rail selects which model the sheet edits', () => {
    render(
      <Harness
        models={[
          { model: 'model-a', input: 1 },
          { model: 'model-b', input: 7 },
        ]}
      />
    )

    // The first row is selected on open, so the pane is never blank while the
    // rail lists models beside it.
    expect(screen.getByLabelText('Buy price (Input)')).toHaveValue(1)

    selectModel('model-b')
    expect(screen.getByLabelText('Buy price (Input)')).toHaveValue(7)
  })

  test('removing the selected model lands on its neighbour', () => {
    render(
      <Harness
        models={[
          { model: 'model-a', input: 1 },
          { model: 'model-b', input: 2 },
          { model: 'model-c', input: 3 },
        ]}
      />
    )

    selectModel('model-b')
    fireEvent.click(screen.getByRole('button', { name: 'Remove model price' }))

    expect(screen.queryByText('model-b')).toBeNull()
    // The row that slid into the gap, not nothing and not the top of the list.
    expect(screen.getByLabelText('Buy price (Input)')).toHaveValue(3)
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

    // Appended as rows rather than silently priced, and the first new one is
    // selected so the operator is already where the typing happens.
    expect(screen.getByText('deepseek-v4.1-flash')).toBeInTheDocument()
    expect(screen.getByLabelText('Buy price (Input)')).toHaveValue(null)
    expect(
      screen.queryByRole('button', { name: /Import channel models/ })
    ).not.toBeInTheDocument()
  })

  test('a search that hides the selected model moves the sheet to a visible one', () => {
    // Six rows: the search box only appears once the rail is long enough to
    // need one.
    render(
      <Harness
        models={[
          { model: 'alpha-1', input: 1 },
          ...Array.from({ length: 5 }, (_, i) => ({
            model: `beta-${i}`,
            input: 9,
          })),
        ]}
      />
    )

    expect(screen.getByLabelText('Buy price (Input)')).toHaveValue(1)

    fireEvent.change(screen.getByLabelText('Search models...'), {
      target: { value: 'beta' },
    })

    // Rows are hidden, never re-indexed, so the sheet has to follow the rail
    // rather than keep editing a row that is no longer listed.
    expect(screen.queryByText('alpha-1')).toBeNull()
    expect(screen.getByLabelText('Buy price (Input)')).toHaveValue(9)
  })

  test('the empty state states why a buy price is needed', () => {
    render(<Harness models={[]} />)

    expect(screen.getByText('No model priced yet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buy price (Input)')).not.toBeInTheDocument()
  })
})
