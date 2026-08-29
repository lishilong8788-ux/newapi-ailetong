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

import type { InvoiceRequest } from '../types'
import { formatInvoiceAmount, parseTradeNumbers } from './format'

/** One transcribable line of the issuing worksheet. */
export type InvoiceCopyField = {
  id: string
  label: string
  value: string
  /** Render the value in a monospace face — tax ids, bank accounts, amounts. */
  mono?: boolean
}

/**
 * A titled block of the worksheet. The operator fills the invoicing platform in
 * the same two passes — who the invoice is for, then what it covers — so the
 * fields are grouped that way instead of arriving as one flat list.
 */
export type InvoiceCopyGroup = {
  id: 'buyer' | 'content'
  title: string
  fields: InvoiceCopyField[]
}

/**
 * Builds the grouped worksheet finance transcribes into the invoicing platform.
 * Personal titles carry no tax id or bank details, so those rows are dropped
 * rather than shown empty — an empty row invites a wrong entry.
 *
 * The related order numbers are deliberately absent: they are rendered as a
 * per-order breakdown with amounts instead, which a single copy row cannot
 * express. `formatInvoiceCopySheet` still appends them so one paste carries
 * everything.
 */
export function getInvoiceCopyGroups(
  request: InvoiceRequest,
  t: TFunction
): InvoiceCopyGroup[] {
  const isCompany = request.title_type === 'company'

  const fields: InvoiceCopyField[] = [
    { id: 'title', label: t('Invoice Title'), value: request.title },
  ]

  if (isCompany) {
    fields.push({
      id: 'tax_no',
      label: t('Taxpayer Identification Number'),
      value: request.tax_no,
      mono: true,
    })
  }

  fields.push(
    { id: 'address', label: t('Address'), value: request.address },
    { id: 'phone', label: t('Phone'), value: request.phone, mono: true }
  )

  if (isCompany) {
    fields.push(
      { id: 'bank_name', label: t('Bank Name'), value: request.bank_name },
      {
        id: 'bank_account',
        label: t('Bank Account'),
        value: request.bank_account,
        mono: true,
      }
    )
  }

  const amountFields: InvoiceCopyField[] = [
    {
      id: 'amount_total',
      label: t('Invoice Amount'),
      value: formatInvoiceAmount(request.amount_total, request.currency),
      mono: true,
    },
  ]

  return [
    {
      id: 'buyer',
      title: t('Buyer Information'),
      fields: fields.filter((field) => field.value.trim().length > 0),
    },
    {
      id: 'content',
      title: t('Invoice Content'),
      fields: amountFields,
    },
  ]
}

/**
 * Flattens the worksheet into the multi-line block behind "Copy All", so one
 * paste carries every field in the same order shown on screen. The separator
 * itself is translated because CJK locales use a full-width colon.
 *
 * Order numbers are appended here even though they have no copy row of their
 * own: a paste that omitted them would not reconcile against the payment
 * platform.
 */
export function formatInvoiceCopySheet(
  groups: InvoiceCopyGroup[],
  request: InvoiceRequest,
  t: TFunction
): string {
  const lines = groups.flatMap((group) =>
    group.fields.map((field) =>
      t('{{label}}: {{value}}', { label: field.label, value: field.value })
    )
  )

  const tradeNumbers = parseTradeNumbers(request.trade_no_snapshot)
  if (tradeNumbers.length > 0) {
    lines.push(
      t('{{label}}: {{value}}', {
        label: t('Related Order Numbers'),
        value: tradeNumbers.join(', '),
      })
    )
  }

  return lines.join('\n')
}
