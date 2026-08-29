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
import type React from 'react'
import { describe, expect, test } from 'vitest'

import type { InvoiceableOrder } from '../../types'
import { PendingOrdersTab } from '../pending-orders-tab'

const ORDER: InvoiceableOrder = {
  source_type: 'topup',
  source_id: 41,
  trade_no: '2026082800041',
  amount: 19_900,
  currency: 'CNY',
  pay_time: 1_772_000_000,
}

function renderTab(
  overrides: Partial<React.ComponentProps<typeof PendingOrdersTab>> = {}
): ReturnType<typeof render> {
  return render(
    <PendingOrdersTab
      orders={[]}
      loading={false}
      selectedKeys={[]}
      selectedCount={0}
      mixedCurrency={false}
      onToggleOrder={() => undefined}
      onToggleAll={() => undefined}
      onRequestSingle={() => undefined}
      {...overrides}
    />
  )
}

describe('pending orders tab', () => {
  test('keeps the column headers visible when there is nothing to invoice', () => {
    renderTab()

    // The empty state is a table row, not a replacement for the table, so the
    // header band stays put and the layout does not jump between states.
    expect(
      screen.getByRole('columnheader', { name: 'Order Number' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Payment Amount' })
    ).toBeInTheDocument()
    expect(screen.getByText('No orders awaiting invoicing')).toBeInTheDocument()
  })

  test('disables select-all on an empty list so it cannot be armed', () => {
    renderTab()

    // Base UI renders the checkbox as a span, so the disabled state is carried
    // by aria-disabled rather than the native attribute.
    expect(
      screen.getByRole('checkbox', { name: 'Select all orders' })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  test('shows the skeleton while loading instead of the empty state', () => {
    const rendered = renderTab({ loading: true })

    expect(
      rendered.container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    expect(
      screen.queryByText('No orders awaiting invoicing')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('drops the empty state once an order arrives', () => {
    renderTab({ orders: [ORDER] })

    expect(
      screen.queryByText('No orders awaiting invoicing')
    ).not.toBeInTheDocument()
    expect(screen.getByText('¥199.00')).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Select all orders' })
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('tints an order row on hover but leaves the empty state flat', () => {
    const withOrder = renderTab({ orders: [ORDER] })

    expect(withOrder.container.querySelector('tbody tr')).toHaveClass(
      'transition-colors',
      'hover:[background-color:var(--muted)]'
    )

    withOrder.unmount()

    // The empty state is not a record, so it must not light up under the
    // pointer the way a row does.
    const empty = renderTab()
    expect(empty.container.querySelector('tbody tr')).toHaveClass(
      'hover:bg-transparent'
    )
  })

  test('warns before submitting a selection that spans two currencies', () => {
    renderTab({ orders: [ORDER], mixedCurrency: true, selectedCount: 2 })

    expect(
      screen.getByText(/One invoice can only cover a single currency\./)
    ).toBeInTheDocument()
  })
})
