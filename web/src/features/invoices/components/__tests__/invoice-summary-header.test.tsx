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
import { describe, expect, test } from 'vitest'

import type { InvoiceAmountSummary } from '../../types'
import { InvoiceSummaryHeader } from '../invoice-summary-header'

const CNY: InvoiceAmountSummary = {
  currency: 'CNY',
  pending_minor: 12_345,
  issued_minor: 200_000,
  invoiceable_minor: 4_999,
}

const USD: InvoiceAmountSummary = {
  currency: 'USD',
  pending_minor: 0,
  issued_minor: 7_000,
  invoiceable_minor: 1_050,
}

describe('invoice summary header', () => {
  test('keeps each currency on its own row instead of merging the totals', () => {
    render(<InvoiceSummaryHeader summaries={[CNY, USD]} loading={false} />)

    // Two currencies means two independent positions. A single merged figure
    // would be a money bug: ¥ and $ amounts are not addable.
    expect(screen.getByText('¥123.45')).toBeInTheDocument()
    expect(screen.getByText('¥2,000.00')).toBeInTheDocument()
    expect(screen.getByText('¥49.99')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.getByText('$70.00')).toBeInTheDocument()
    expect(screen.getByText('$10.50')).toBeInTheDocument()

    expect(screen.getAllByText('Pending Amount')).toHaveLength(2)
    expect(screen.getAllByText('Invoiceable Amount')).toHaveLength(2)
  })

  test('falls back to a zeroed row when the user has no figures yet', () => {
    render(<InvoiceSummaryHeader summaries={[]} loading={false} />)

    // A brand-new account must still see the three labelled slots, otherwise
    // the header collapses and the card looks broken.
    expect(screen.getByText('Pending Amount')).toBeInTheDocument()
    expect(screen.getByText('Invoiced Amount')).toBeInTheDocument()
    expect(screen.getByText('Invoiceable Amount')).toBeInTheDocument()
    expect(screen.getAllByText('¥0.00')).toHaveLength(3)
  })

  test('shows placeholders while loading rather than a misleading zero', () => {
    const rendered = render(<InvoiceSummaryHeader summaries={[]} loading />)

    expect(
      rendered.container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument()
  })

  test('always renders the invoicing notes alongside the figures', () => {
    render(<InvoiceSummaryHeader summaries={[CNY]} loading={false} />)

    expect(screen.getByText('Invoicing Notes')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Orders paid within the last 12 months are eligible for invoicing.'
      )
    ).toBeInTheDocument()
  })
})
