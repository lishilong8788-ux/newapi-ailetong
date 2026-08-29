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
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { InvoiceRequest } from '../types'
import { InvoiceRequestRow } from './invoice-request-row'
import {
  INVOICE_TABLE_CLASS,
  INVOICE_TABLE_HEADER_ROW_CLASS,
  InvoiceTableEmptyRow,
} from './invoice-table-chrome'
import { InvoiceTableSkeleton } from './invoice-table-skeleton'

interface InvoiceRequestsTabProps {
  requests: InvoiceRequest[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  cancelling: boolean
  onPageChange: (page: number) => void
  onDownload: (request: InvoiceRequest) => void
  onCancel: (request: InvoiceRequest) => void
}

export function InvoiceRequestsTab(props: InvoiceRequestsTabProps) {
  const { t } = useTranslation()
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize))
  const rangeStart =
    props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1
  const rangeEnd = Math.min(props.page * props.pageSize, props.total)

  if (props.loading) {
    return <InvoiceTableSkeleton columns={6} />
  }

  return (
    <div>
      <Table className={INVOICE_TABLE_CLASS}>
        <TableHeader>
          <TableRow className={INVOICE_TABLE_HEADER_ROW_CLASS}>
            <TableHead>{t('Invoice Number')}</TableHead>
            <TableHead>{t('Invoice Title')}</TableHead>
            <TableHead>{t('Amount')}</TableHead>
            <TableHead>{t('Status')}</TableHead>
            <TableHead>{t('Requested At')}</TableHead>
            <TableHead className='text-right'>{t('Actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.requests.length === 0 && (
            <InvoiceTableEmptyRow
              colSpan={6}
              icon={FileText}
              title={t('No invoices yet')}
              description={t(
                'Submitted invoice requests and their status will appear here.'
              )}
            />
          )}
          {props.requests.map((request) => (
            <InvoiceRequestRow
              key={request.id}
              request={request}
              cancelling={props.cancelling}
              onDownload={props.onDownload}
              onCancel={props.onCancel}
            />
          ))}
        </TableBody>
      </Table>

      {props.requests.length > 0 && (
        <div className='flex flex-col items-center gap-3 border-t px-4 py-3 sm:flex-row sm:justify-between'>
          <p className='text-muted-foreground text-[13px]'>
            {t('Showing')} {rangeStart}-{rangeEnd} {t('of')} {props.total}
          </p>
          <div className='flex items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='icon'
              className='size-8'
              aria-label={t('Previous page')}
              disabled={props.page <= 1}
              onClick={() => props.onPageChange(props.page - 1)}
            >
              <ChevronLeft className='size-4' aria-hidden='true' />
            </Button>
            <span className='text-muted-foreground flex items-center gap-1 text-sm tabular-nums'>
              <span className='text-foreground font-medium'>{props.page}</span>
              <span>/</span>
              <span>{totalPages}</span>
            </span>
            <Button
              type='button'
              variant='outline'
              size='icon'
              className='size-8'
              aria-label={t('Next page')}
              disabled={props.page >= totalPages}
              onClick={() => props.onPageChange(props.page + 1)}
            >
              <ChevronRight className='size-4' aria-hidden='true' />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
