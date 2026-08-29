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
import type { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'

import type { InvoiceRequest } from '../../types'
import { formatInvoiceCopySheet, getInvoiceCopyGroups } from '../copy-sheet'

// Mirrors i18next's interpolation for the two patterns the sheet uses, so the
// assertions read as the operator sees them.
const t = ((key: string, params?: Record<string, unknown>) => {
  if (!params) return key
  return key.replaceAll(/{{(\w+)}}/g, (_, name) => String(params[name] ?? ''))
}) as unknown as TFunction

const COMPANY: InvoiceRequest = {
  id: 1,
  user_id: 42,
  invoice_type: 'normal',
  status: 'pending',
  profile_id: 3,
  title_type: 'company',
  title: 'Acme Inc.',
  tax_no: '91310000MA1K35Q1XY',
  address: 'Zhangjiang Road 88',
  phone: '021-58889900',
  bank_name: 'CMB Shanghai',
  bank_account: '121905558800301',
  amount_total: 468_000,
  currency: 'CNY',
  recipient_email: 'finance@acme.test',
  remark: '',
  invoice_no: '',
  pdf_url: '',
  reject_reason: '',
  trade_no_snapshot: '2026082700318, 2026082700319',
  create_time: 1_772_000_000,
  issue_time: 0,
  email_sent_at: 0,
  email_error: '',
}

const PERSONAL: InvoiceRequest = {
  ...COMPANY,
  title_type: 'personal',
  title: 'Li Shilong',
  tax_no: '',
  bank_name: '',
  bank_account: '',
}

describe('invoice copy sheet grouping', () => {
  test('splits the worksheet into buyer and content blocks', () => {
    const groups = getInvoiceCopyGroups(COMPANY, t)

    expect(groups.map((group) => group.id)).toEqual(['buyer', 'content'])
    expect(groups[0].fields.map((field) => field.id)).toEqual([
      'title',
      'tax_no',
      'address',
      'phone',
      'bank_name',
      'bank_account',
    ])
    expect(groups[1].fields.map((field) => field.id)).toEqual(['amount_total'])
  })

  test('drops company-only rows for a personal title instead of showing them empty', () => {
    const buyer = getInvoiceCopyGroups(PERSONAL, t)[0]

    expect(buyer.fields.map((field) => field.id)).toEqual([
      'title',
      'address',
      'phone',
    ])
  })

  test('keeps order numbers out of the rows but inside Copy All', () => {
    const groups = getInvoiceCopyGroups(COMPANY, t)
    const ids = groups.flatMap((group) => group.fields.map((field) => field.id))

    // They are rendered as a per-order breakdown with amounts, which a single
    // copy row cannot express — but a paste that omitted them would not
    // reconcile against the payment platform.
    expect(ids).not.toContain('trade_no_snapshot')

    const sheet = formatInvoiceCopySheet(groups, COMPANY, t)
    expect(sheet).toContain(
      'Related Order Numbers: 2026082700318, 2026082700319'
    )
    expect(sheet).toContain('Invoice Amount: ¥4680.00')
    expect(sheet.split('\n').at(-1)).toContain('Related Order Numbers')
  })

  test('omits the order line when the snapshot is empty', () => {
    const request = { ...COMPANY, trade_no_snapshot: '' }
    const sheet = formatInvoiceCopySheet(
      getInvoiceCopyGroups(request, t),
      request,
      t
    )

    expect(sheet).not.toContain('Related Order Numbers')
  })
})
