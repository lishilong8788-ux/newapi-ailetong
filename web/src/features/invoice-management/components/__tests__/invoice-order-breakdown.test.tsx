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

import type { InvoiceItem, InvoiceRequest } from '../../types'
import { InvoiceOrderBreakdown } from '../invoice-order-breakdown'

const MERGED: InvoiceRequest = {
  id: 9001,
  user_id: 42,
  invoice_type: 'special',
  status: 'pending',
  profile_id: 3,
  title_type: 'company',
  title: 'Acme Inc.',
  tax_no: '91310000MA1K35Q1XY',
  address: '',
  phone: '',
  bank_name: '',
  bank_account: '',
  amount_total: 468_000,
  currency: 'CNY',
  recipient_email: 'finance@acme.test',
  remark: '',
  invoice_no: '',
  pdf_url: '',
  reject_reason: '',
  trade_no_snapshot: '2026082700318,2026082700319,2026082700320',
  create_time: 1_772_000_000,
  issue_time: 0,
  email_sent_at: 0,
  email_error: '',
}

const ITEMS: InvoiceItem[] = [
  {
    id: 1,
    request_id: 9001,
    source_type: 'topup',
    source_id: 1,
    trade_no: '2026082700318',
    amount: 156_000,
    currency: 'CNY',
    pay_time: 1_771_900_000,
  },
  {
    id: 2,
    request_id: 9001,
    source_type: 'topup',
    source_id: 2,
    trade_no: '2026082700319',
    amount: 156_000,
    currency: 'CNY',
    pay_time: 1_771_900_600,
  },
  {
    id: 3,
    request_id: 9001,
    source_type: 'topup',
    source_id: 3,
    trade_no: '2026082700320',
    amount: 156_000,
    currency: 'CNY',
    pay_time: 0,
  },
]

describe('invoice order breakdown', () => {
  test('names the merge and shows what each order contributed', () => {
    render(<InvoiceOrderBreakdown request={MERGED} items={ITEMS} />)

    expect(
      screen.getByText('Covers 3 orders (merged invoice)')
    ).toBeInTheDocument()
    for (const item of ITEMS) {
      expect(screen.getByText(item.trade_no)).toBeInTheDocument()
    }
    expect(screen.getAllByText('¥1560.00')).toHaveLength(3)
    // Two items carry a pay_time snapshot; the third predates the column and
    // must simply omit the line rather than render a bogus date.
    expect(screen.getAllByText(/^Paid /)).toHaveLength(2)
    // The total is what the invoice is written for, so it has to be checkable
    // against the lines above it.
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('¥4680.00')).toBeInTheDocument()
  })

  test('falls back to the snapshot numbers while the amounts load', () => {
    render(<InvoiceOrderBreakdown request={MERGED} isLoading />)

    // Without this the popover would be empty on first open, which reads as
    // "no orders" rather than "still loading".
    expect(screen.getByText('2026082700318')).toBeInTheDocument()
    expect(screen.getByText('2026082700319')).toBeInTheDocument()
    expect(screen.queryByText('¥1560.00')).not.toBeInTheDocument()
  })

  test('drops the merge wording and the total for a single order', () => {
    const single = { ...MERGED, trade_no_snapshot: '2026082700318' }

    render(<InvoiceOrderBreakdown request={single} items={[ITEMS[0]]} />)

    expect(screen.getByText('Covers 1 order')).toBeInTheDocument()
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
  })

  test('renders nothing when there are no orders at all', () => {
    const { container } = render(
      <InvoiceOrderBreakdown
        request={{ ...MERGED, trade_no_snapshot: '' }}
        items={[]}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
