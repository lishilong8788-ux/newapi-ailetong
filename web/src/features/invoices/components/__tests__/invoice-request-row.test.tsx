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

import { Table, TableBody } from '@/components/ui/table'

import type { InvoiceRequest } from '../../types'
import { InvoiceRequestRow } from '../invoice-request-row'

const HOVER_TINT = 'hover:[background-color:var(--muted)]'

const REQUEST: InvoiceRequest = {
  id: 11,
  user_id: 42,
  invoice_type: 'normal',
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
  invoice_no: 'INV-2026-0007',
  pdf_url: 'https://invoices.test/INV-2026-0007.pdf',
  reject_reason: '',
  trade_no_snapshot: '2026082800041',
  create_time: 1_772_000_000,
  issue_time: 1_772_003_600,
  email_sent_at: 0,
  email_error: '',
}

function renderRow(overrides: Partial<InvoiceRequest> = {}) {
  return render(
    <Table>
      <TableBody>
        <InvoiceRequestRow
          request={{ ...REQUEST, ...overrides }}
          cancelling={false}
          onDownload={() => undefined}
          onCancel={() => undefined}
        />
      </TableBody>
    </Table>
  )
}

describe('invoice request row hover', () => {
  test('tints the row on hover with a colour transition', () => {
    const rendered = renderRow()

    const rows = rendered.container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveClass('transition-colors', HOVER_TINT)
  })

  test('lights both halves of a rejected request together', () => {
    // A rejected request spans two rows with no shared wrapper, so each row has
    // to react to its sibling being hovered or the record highlights in half.
    const rendered = renderRow({
      status: 'rejected',
      reject_reason: 'Tax number does not match the registered company name.',
    })

    const rows = rendered.container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveClass(
      HOVER_TINT,
      'has-[+tr:hover]:[background-color:var(--muted)]'
    )
    expect(rows[1]).toHaveClass(
      HOVER_TINT,
      '[tr:hover+&]:[background-color:var(--muted)]'
    )
    expect(
      screen.getByText(/Tax number does not match the registered company name/)
    ).toBeInTheDocument()
  })
})
