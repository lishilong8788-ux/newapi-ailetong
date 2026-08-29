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
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { formatTimestampToDate } from '@/lib/format'

import { INVOICE_STATUSES } from '../constants'
import { formatInvoiceAmount } from '../lib'
import type { InvoiceRequest } from '../types'
import { DataTableRowActions } from './data-table-row-actions'
import { InvoiceEmailStatusCell } from './invoice-email-status-cell'
import { InvoiceOrdersCell } from './invoice-orders-cell'

export function useInvoicesColumns(): ColumnDef<InvoiceRequest>[] {
  const { t } = useTranslation()

  return [
    {
      // Continuous across pages: the page offset plus the row's index within
      // the page. Purely positional — filtering renumbers it by design.
      id: 'index',
      header: () => t('#'),
      cell: ({ table, row }) => {
        const { pageIndex, pageSize } = table.getState().pagination
        return (
          <span className='text-muted-foreground text-sm tabular-nums'>
            {pageIndex * pageSize + row.index + 1}
          </span>
        )
      },
      enableSorting: false,
      size: 56,
    },
    {
      id: 'user',
      header: t('User'),
      cell: ({ row }) => (
        <div className='flex items-center gap-1'>
          <span className='min-w-0 truncate text-sm'>
            {row.original.username || row.original.user_id}
          </span>
          <CopyButton
            value={String(row.original.user_id)}
            size='sm'
            className='size-7 p-0'
            iconClassName='size-3.5'
            tooltip={t('Copy user ID')}
            aria-label={t('Copy user ID')}
          />
        </div>
      ),
      enableSorting: false,
      size: 140,
    },
    {
      accessorKey: 'create_time',
      header: t('Requested At'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <div className='min-w-[150px] font-mono text-sm'>
          {formatTimestampToDate(row.original.create_time)}
        </div>
      ),
      enableSorting: false,
      size: 170,
    },
    {
      id: 'title',
      header: t('Invoice Title'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='min-w-0 space-y-0.5'>
          <div className='flex items-center gap-1'>
            <span className='min-w-0 truncate text-sm font-medium'>
              {row.original.title}
            </span>
            <CopyButton
              value={row.original.title}
              size='sm'
              className='size-7 p-0'
              iconClassName='size-3.5'
              tooltip={t('Copy invoice title')}
              aria-label={t('Copy invoice title')}
            />
          </div>
          {row.original.tax_no ? (
            <div className='flex items-center gap-1'>
              <span className='text-muted-foreground min-w-0 truncate font-mono text-xs'>
                {row.original.tax_no}
              </span>
              <CopyButton
                value={row.original.tax_no}
                size='sm'
                className='size-7 p-0'
                iconClassName='size-3.5'
                tooltip={t('Copy tax number')}
                aria-label={t('Copy tax number')}
              />
            </div>
          ) : (
            <span className='text-muted-foreground text-xs'>
              {t('Personal')}
            </span>
          )}
        </div>
      ),
      enableSorting: false,
      size: 280,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const config =
          INVOICE_STATUSES[row.original.status] ?? INVOICE_STATUSES.pending
        return (
          <div className='space-y-1'>
            <StatusBadge
              label={t(config.labelKey)}
              variant={config.variant}
              copyable={false}
              className='-ms-1.5'
            />
            {row.original.status === 'issued' &&
              row.original.issue_time > 0 && (
                <div className='text-muted-foreground text-xs whitespace-nowrap tabular-nums'>
                  {formatTimestampToDate(row.original.issue_time)}
                </div>
              )}
          </div>
        )
      },
      enableSorting: false,
      size: 130,
    },
    {
      accessorKey: 'amount_total',
      header: t('Amount'),
      cell: ({ row }) => (
        <span className='font-medium tabular-nums'>
          {formatInvoiceAmount(
            row.original.amount_total,
            row.original.currency
          )}
        </span>
      ),
      enableSorting: false,
      size: 120,
    },
    {
      accessorKey: 'recipient_email',
      header: t('Recipient Email'),
      cell: ({ row }) => (
        <div className='flex min-w-0 items-center gap-1'>
          <span className='min-w-0 truncate text-sm'>
            {row.original.recipient_email}
          </span>
          <CopyButton
            value={row.original.recipient_email}
            size='sm'
            className='size-7 p-0'
            iconClassName='size-3.5'
            tooltip={t('Copy recipient email')}
            aria-label={t('Copy recipient email')}
          />
        </div>
      ),
      enableSorting: false,
      size: 220,
    },
    {
      id: 'orders',
      header: t('Related Orders'),
      cell: ({ row }) => <InvoiceOrdersCell request={row.original} />,
      enableSorting: false,
      size: 130,
    },
    {
      id: 'email_status',
      header: t('Email Status'),
      cell: ({ row }) => <InvoiceEmailStatusCell request={row.original} />,
      enableSorting: false,
      size: 140,
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      cell: ({ row }) => <DataTableRowActions request={row.original} />,
      meta: { pinned: 'right' as const },
      size: 180,
    },
  ]
}
