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
// ============================================================================
// Shared table chrome for the invoice tabs
//
// Both invoice tables sit flush inside the page card, so they carry no border of
// their own: a shaded header band separates them from the toolbar instead, and
// the row padding is widened to keep the text off the card edge.
// ============================================================================
import type { LucideIcon } from 'lucide-react'

import { TableCell, TableRow } from '@/components/ui/table'

/** Widened cell padding so the first and last columns clear the card edge. */
export const INVOICE_TABLE_CLASS = '[&_td]:px-4 [&_th]:px-4'

/**
 * Shaded header band. The tint is applied to the cells rather than the row so it
 * cannot be repainted by `TableRow`'s hover background, and it is written as a
 * descendant selector so the same class works on a `TableRow` and on the
 * `<thead>` of a shared `DataTablePage`.
 */
export const INVOICE_TABLE_HEADER_ROW_CLASS = '[&_th]:bg-muted/60 [&_th]:h-11'

/**
 * Row hover tint. `TableRow`'s default hover mixes half of `--muted` into the
 * background, which is all but invisible on a white card, so the invoice tables
 * step up to the full token. Written as an arbitrary property so it collapses
 * with the base `hover:[background-color:…]` in `tailwind-merge` instead of
 * relying on stylesheet order.
 */
export const INVOICE_TABLE_ROW_CLASS =
  'transition-colors hover:[background-color:var(--muted)]'

interface InvoiceTableEmptyRowProps {
  colSpan: number
  icon: LucideIcon
  title: string
  description: string
}

/**
 * Empty state rendered as a table row, which keeps the column headers visible
 * so the reader can still see what the list would have contained.
 */
export function InvoiceTableEmptyRow(props: InvoiceTableEmptyRowProps) {
  const Icon = props.icon

  return (
    <TableRow className='hover:bg-transparent'>
      <TableCell colSpan={props.colSpan} className='h-auto py-16 text-center'>
        <div className='flex flex-col items-center gap-3'>
          <div className='bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-xl'>
            <Icon className='size-5' aria-hidden='true' />
          </div>
          <div className='space-y-1'>
            <p className='text-foreground text-sm font-semibold'>
              {props.title}
            </p>
            <p className='text-muted-foreground text-[13px] whitespace-normal'>
              {props.description}
            </p>
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}
