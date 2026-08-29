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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { InvoiceRequest } from '../../types'

const navigate = vi.fn()
const useSearch = vi.fn(() => ({}) as Record<string, unknown>)

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch,
    useNavigate: () => navigate,
  }),
}))

const listInvoiceRequests = vi.fn()
vi.mock('../../api', () => ({
  listInvoiceRequests: (...args: unknown[]) => listInvoiceRequests(...args),
}))

const { InvoicesTable } = await import('../invoices-table')
const { InvoicesProvider } = await import('../invoices-provider')

const REQUEST: InvoiceRequest = {
  id: 7,
  user_id: 42,
  invoice_type: 'normal',
  // An issued request keeps the actions column populated without mounting the
  // Base UI dropdown, whose popup store loops under jsdom.
  status: 'issued',
  profile_id: 3,
  title_type: 'company',
  title: 'Acme Inc.',
  tax_no: '91310000MA1K35Q1XY',
  address: '',
  phone: '',
  bank_name: '',
  bank_account: '',
  amount_total: 19_900,
  currency: 'CNY',
  recipient_email: 'finance@acme.test',
  remark: '',
  invoice_no: '',
  pdf_url: '',
  reject_reason: '',
  trade_no_snapshot: '2026082800041',
  create_time: 1_772_000_000,
  issue_time: 1_772_200_000,
  email_sent_at: 0,
  email_error: '',
  username: 'acme-finance',
}

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <InvoicesProvider>
        <InvoicesTable />
      </InvoicesProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useSearch.mockReturnValue({})
  listInvoiceRequests.mockResolvedValue({
    success: true,
    data: { items: [REQUEST], total: 1 },
  })
})

describe('invoice management status tab', () => {
  test('opens on the pending queue when the URL carries no status', async () => {
    renderTable()

    expect(await screen.findByRole('tab', { name: 'Pending' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    await waitFor(() => {
      expect(listInvoiceRequests).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' })
      )
    })
  })

  test('sends no status once the All tab is chosen explicitly', async () => {
    useSearch.mockReturnValue({ status: 'all' })

    renderTable()

    expect(await screen.findByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await waitFor(() => {
      expect(listInvoiceRequests).toHaveBeenCalledWith(
        expect.objectContaining({ status: '' })
      )
    })
  })

  test('writes the chosen status to the URL, All included', async () => {
    renderTable()

    await screen.findByRole('tab', { name: 'All' })
    await userEvent.click(screen.getByRole('tab', { name: 'All' }))

    // Clearing the param instead would read back as the default Pending tab.
    const search = navigate.mock.calls.at(-1)?.[0].search
    expect(search({})).toMatchObject({ status: 'all' })
  })
})

describe('invoice management table chrome', () => {
  test('keeps the tab strip and the toolbar on one header row inside the card', async () => {
    const rendered = renderTable()

    const tabList = await screen.findByRole('tablist')
    const search = screen.getByPlaceholderText(
      'Filter by invoice title, tax number or order number...'
    )
    const card = rendered.container.querySelector('[data-slot="tabs"]')
    const headerRow = tabList.parentElement

    // The tab strip and the toolbar share one row, and that row is a direct
    // child of the card — not two stacked bands floating above a bordered
    // table.
    expect(headerRow).toContainElement(search)
    expect(headerRow?.parentElement).toBe(card)

    await waitFor(() => {
      expect(screen.getByText('Acme Inc.')).toBeInTheDocument()
    })
    expect(card).toContainElement(rendered.container.querySelector('table'))
  })

  test('shades the header band and widens the cells inside the card', async () => {
    const rendered = renderTable()

    await waitFor(() => {
      expect(screen.getByText('Acme Inc.')).toBeInTheDocument()
    })

    const header = rendered.container.querySelector(
      '[data-slot="table-header"]'
    )
    expect(header).toHaveClass('[&_th]:bg-muted/60', '[&_th]:h-11')

    // The card owns the frame, so the table container drops its own border and
    // pads the cells instead.
    const tableFrame = rendered.container.querySelector('.rounded-none')
    expect(tableFrame).toHaveClass('border-0', '[&_td]:px-4', '[&_th]:px-4')
  })

  test('gives every body row the hover tint, pinned column included', async () => {
    const rendered = renderTable()

    await waitFor(() => {
      expect(screen.getByText('Acme Inc.')).toBeInTheDocument()
    })

    const row = rendered.container.querySelector(
      '[data-slot="table-body"] [data-slot="table-row"]'
    )
    expect(row).toHaveClass(
      'transition-colors',
      'hover:[background-color:var(--muted)]'
    )

    // The sticky actions cell paints its own background over the row, so it
    // needs the tint restated under the row's hover.
    const pinnedCell = rendered.container.querySelector(
      '[data-slot="table-body"] [data-column-id="actions"]'
    )
    expect(pinnedCell).toHaveClass(
      'sticky',
      'group-hover:[background-color:var(--muted)]'
    )
  })

  test('reads who applied, when, and when it was issued — in that column order', async () => {
    const rendered = renderTable()

    await waitFor(() => {
      expect(screen.getByText('Acme Inc.')).toBeInTheDocument()
    })

    // Username instead of the bare numeric id, with the id still one click
    // away behind the copy button.
    expect(screen.getByText('acme-finance')).toBeInTheDocument()
    expect(screen.getByLabelText('Copy user ID')).toBeInTheDocument()

    // 申请时间 sits between the user and the title, and the issued badge
    // carries the issue date beneath it — "who applied what, when".
    const headerCells = rendered.container.querySelectorAll(
      '[data-slot="table-header"] th'
    )
    const labels = [...headerCells].map((cell) => cell.textContent)
    expect(labels.indexOf('Requested At')).toBeGreaterThan(
      labels.indexOf('User')
    )
    expect(labels.indexOf('Requested At')).toBeLessThan(
      labels.indexOf('Invoice Title')
    )

    const statusCell = rendered.container.querySelector(
      '[data-slot="table-body"] [data-column-id="status"]'
    )
    expect(statusCell).toHaveTextContent('Issued')
    expect(statusCell?.textContent).toMatch(/2026-02-2\d/)
  })

  test('numbers rows continuously from the page offset', async () => {
    const rendered = renderTable()

    await waitFor(() => {
      expect(screen.getByText('Acme Inc.')).toBeInTheDocument()
    })

    const indexCell = rendered.container.querySelector(
      '[data-slot="table-body"] [data-column-id="index"]'
    )
    expect(indexCell).toHaveTextContent('1')
  })

  test('falls back to the icon empty state when nothing matches', async () => {
    listInvoiceRequests.mockResolvedValue({
      success: true,
      data: { items: [], total: 0 },
    })

    renderTable()

    expect(
      await screen.findByText('No Invoice Requests Found')
    ).toBeInTheDocument()
    expect(
      screen.getByText('No invoice requests match the current filters.')
    ).toBeInTheDocument()
  })
})
