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
import type { Table as TanstackTable } from '@tanstack/react-table'
import { ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTimestampToDate } from '@/lib/format'

import { INVOICE_STATUSES } from '../constants'
import { formatInvoiceAmount } from '../lib'
import type { InvoiceRequest } from '../types'
import { DataTableRowActions } from './data-table-row-actions'
import { InvoiceEmailStatusCell } from './invoice-email-status-cell'
import { InvoiceOrdersCell } from './invoice-orders-cell'

const MOBILE_SKELETON_KEYS = [
  'invoice-mobile-skeleton-1',
  'invoice-mobile-skeleton-2',
  'invoice-mobile-skeleton-3',
  'invoice-mobile-skeleton-4',
  'invoice-mobile-skeleton-5',
]

function InvoicesMobileSkeleton() {
  return (
    <div className='divide-border'>
      {MOBILE_SKELETON_KEYS.map((key) => (
        <div
          key={key}
          className='space-y-2 border-b px-4 py-2.5 last:border-b-0'
        >
          <div className='flex items-center justify-between'>
            <Skeleton className='h-4 w-40' />
            <Skeleton className='h-5 w-16 rounded-md' />
          </div>
          <Skeleton className='h-3 w-32' />
          <div className='flex items-center justify-between gap-3'>
            <Skeleton className='h-4 w-24' />
            <Skeleton className='h-8 w-24' />
          </div>
        </div>
      ))}
    </div>
  )
}

function InvoiceCardRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-2 text-xs'>
      <span className='text-muted-foreground shrink-0'>{props.label}</span>
      <div className='flex min-w-0 items-center justify-end'>
        {props.children}
      </div>
    </div>
  )
}

type InvoicesMobileListProps = {
  table: TanstackTable<InvoiceRequest>
  isLoading: boolean
}

export function InvoicesMobileList(props: InvoicesMobileListProps) {
  const { t } = useTranslation()
  const rows = props.table.getRowModel().rows

  if (props.isLoading) return <InvoicesMobileSkeleton />

  if (!rows.length) {
    return (
      <div className='p-8'>
        <Empty className='border-none p-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <ReceiptText className='size-6' />
            </EmptyMedia>
            <EmptyTitle>{t('No Invoice Requests Found')}</EmptyTitle>
            <EmptyDescription>
              {t('No invoice requests match the current filters.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  // No frame of its own: the list is rendered inside the page card, which
  // already supplies the border and the rounded corners.
  return (
    <div className='divide-border'>
      {rows.map((row) => {
        const request = row.original
        const statusConfig = INVOICE_STATUSES[request.status]

        return (
          <div
            key={row.id}
            className='bg-card space-y-2 border-b px-4 py-2.5 transition-colors last:border-b-0 hover:[background-color:var(--muted)]'
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <div className='flex min-w-0 items-center gap-1'>
                  <span className='truncate text-sm font-semibold'>
                    {request.title}
                  </span>
                  <CopyButton
                    value={request.title}
                    size='sm'
                    className='size-7 p-0'
                    iconClassName='size-3.5'
                    tooltip={t('Copy invoice title')}
                    aria-label={t('Copy invoice title')}
                  />
                </div>
                <div className='text-muted-foreground text-[11px]'>
                  {request.username ||
                    t('User {{id}}', { id: request.user_id })}
                </div>
              </div>
              {statusConfig && (
                <StatusBadge
                  label={t(statusConfig.labelKey)}
                  variant={statusConfig.variant}
                  copyable={false}
                />
              )}
            </div>

            {request.tax_no && (
              <InvoiceCardRow label={t('Tax Number')}>
                <span className='truncate font-mono text-xs'>
                  {request.tax_no}
                </span>
                <CopyButton
                  value={request.tax_no}
                  size='sm'
                  className='size-7 p-0'
                  iconClassName='size-3.5'
                  tooltip={t('Copy tax number')}
                  aria-label={t('Copy tax number')}
                />
              </InvoiceCardRow>
            )}

            <InvoiceCardRow label={t('Amount')}>
              <span className='font-medium tabular-nums'>
                {formatInvoiceAmount(request.amount_total, request.currency)}
              </span>
            </InvoiceCardRow>

            <InvoiceCardRow label={t('Recipient Email')}>
              <span className='truncate'>{request.recipient_email}</span>
              <CopyButton
                value={request.recipient_email}
                size='sm'
                className='size-7 p-0'
                iconClassName='size-3.5'
                tooltip={t('Copy recipient email')}
                aria-label={t('Copy recipient email')}
              />
            </InvoiceCardRow>

            <InvoiceCardRow label={t('Related Orders')}>
              <InvoiceOrdersCell request={request} />
            </InvoiceCardRow>

            {request.status === 'issued' && (
              <InvoiceCardRow label={t('Email Status')}>
                <InvoiceEmailStatusCell request={request} />
              </InvoiceCardRow>
            )}

            <div className='flex items-center justify-between gap-2 pt-0.5'>
              <span className='text-muted-foreground font-mono text-[11px]'>
                {formatTimestampToDate(request.create_time)}
              </span>
              <DataTableRowActions request={request} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
