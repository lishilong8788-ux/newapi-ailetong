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
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { CatalogSupplyTable } = await import('../catalog-supply-table')

const i18n = createInstance()
await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: {} } })

type Row = Parameters<typeof CatalogSupplyTable>[0]['rows'][number]

function makeRow(options: {
  id: number
  name?: string
  serving?: boolean
  models?: string
  settings?: string
  upstreamModel?: string
}): Row {
  return {
    channel: {
      id: options.id,
      type: 1,
      key: '',
      status: 1,
      name: options.name ?? `line-${options.id}`,
      created_time: 0,
      test_time: 0,
      response_time: 0,
      other: '',
      balance: 0,
      balance_updated_time: 0,
      models: options.models ?? 'gpt-4o',
      group: 'default',
      used_quota: 0,
      other_info: '',
      remark: '',
      max_input_tokens: 0,
      channel_info: {
        is_multi_key: false,
        multi_key_size: 0,
        multi_key_polling_index: 0,
        multi_key_mode: 'random',
      },
      settings: options.settings ?? '{}',
    },
    route:
      options.serving === false
        ? undefined
        : {
            channel_id: options.id,
            category: 'vendor',
            latency_ms: 420,
            price: { price_source: 'cost', model_ratio: 1 },
          },
    upstreamModel: options.upstreamModel ?? 'gpt-4o',
    serving: options.serving ?? true,
  } as Row
}

function renderTable(overrides: Partial<Parameters<typeof CatalogSupplyTable>[0]> = {}) {
  const handlers = {
    onAttach: vi.fn(),
    onCreateChannel: vi.fn(),
    onEditChannel: vi.fn(),
    onEditCost: vi.fn(),
    onDetach: vi.fn(),
  }

  render(
    <I18nextProvider i18n={i18n}>
      <CatalogSupplyTable
        modelName='gpt-4o'
        rows={[makeRow({ id: 1 })]}
        isLoading={false}
        canEditCost
        {...handlers}
        {...overrides}
      />
    </I18nextProvider>
  )

  return handlers
}

describe('catalog supply table', () => {
  test('lists a configured-but-idle channel and marks it as idle', () => {
    renderTable({
      rows: [
        makeRow({ id: 1, name: 'serving-line' }),
        makeRow({ id: 2, name: 'idle-line', serving: false }),
      ],
    })

    expect(screen.getByText('idle-line')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
    // The counts share one line, so the assertion is on the summary text as a
    // whole rather than on a standalone node.
    expect(
      screen.getByText(/1 lines serving.*1 configured but idle/)
    ).toBeInTheDocument()
  })

  test('hides the buy-price action from a viewer who cannot write channel settings', () => {
    renderTable({ canEditCost: false })

    expect(
      screen.queryByRole('button', { name: 'Set buy price' })
    ).not.toBeInTheDocument()
    // The channel editor stays reachable: it is the non-sensitive half.
    expect(
      screen.getByRole('button', { name: 'Edit channel' })
    ).toBeInTheDocument()
  })

  test('reports the row a buy-price edit was requested for', async () => {
    const row = makeRow({ id: 7, name: 'azure' })
    const handlers = renderTable({ rows: [row] })

    await userEvent.click(screen.getByRole('button', { name: 'Set buy price' }))

    expect(handlers.onEditCost).toHaveBeenCalledWith(row)
  })

  test('offers both ways to add supply when no channel carries the model', async () => {
    const handlers = renderTable({ rows: [] })

    expect(screen.getByText('No channel carries this model')).toBeInTheDocument()

    await userEvent.click(
      screen.getAllByRole('button', { name: /Add channel/ })[0]
    )
    expect(handlers.onAttach).toHaveBeenCalled()

    await userEvent.click(
      screen.getAllByRole('button', { name: /New channel/ })[0]
    )
    expect(handlers.onCreateChannel).toHaveBeenCalled()
  })

  test('shows the upstream name and flags it when the channel remaps the model', () => {
    renderTable({
      rows: [makeRow({ id: 1, upstreamModel: 'azure-gpt-4o' })],
    })

    expect(screen.getByText('azure-gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('mapped')).toBeInTheDocument()
  })

  test('reports a configured buy price and its margin, not the raw markup', () => {
    renderTable({
      rows: [
        makeRow({
          id: 1,
          settings: JSON.stringify({
            cost: {
              default_markup: 0.3,
              models: { 'gpt-4o': { input: 2, output: 8 } },
            },
          }),
        }),
      ],
    })

    // 2 × 1.3 = 2.6 sell, and a 30% markup is a 23.1% margin.
    expect(screen.getByText('$2')).toBeInTheDocument()
    expect(screen.getByText('$2.6')).toBeInTheDocument()
    expect(screen.getByText('23.1%')).toBeInTheDocument()
  })

  test('says a line has no buy price instead of showing it as free', () => {
    renderTable({ rows: [makeRow({ id: 1, settings: '{}' })] })

    expect(screen.getByText('not set')).toBeInTheDocument()
  })

  test('disables the remove action for the row being detached', () => {
    renderTable({
      rows: [makeRow({ id: 4 })],
      detachingChannelId: 4,
    })

    expect(
      screen.getByRole('button', { name: 'Remove from this channel' })
    ).toBeDisabled()
  })
})
