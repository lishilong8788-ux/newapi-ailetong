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
import { AlertCircle, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { INVOICE_STATUS_CONFIG } from '../constants'
import { formatMinorAmount } from '../lib'
import type { InvoiceRequest } from '../types'
import { INVOICE_TABLE_ROW_CLASS } from './invoice-table-chrome'
import { TradeNoCell } from './trade-no-cell'

interface InvoiceRequestRowProps {
  request: InvoiceRequest
  cancelling: boolean
  onDownload: (request: InvoiceRequest) => void
  onCancel: (request: InvoiceRequest) => void
}

export function InvoiceRequestRow(props: InvoiceRequestRowProps) {
  const { t } = useTranslation()
  const statusConfig =
    INVOICE_STATUS_CONFIG[props.request.status] ?? INVOICE_STATUS_CONFIG.pending
  const rejected =
    props.request.status === 'rejected' &&
    props.request.reject_reason.trim().length > 0

  // A rejected request renders as two rows — the record and the reason beneath
  // it — with no shared wrapper to hang a `group` on, so each row carries the
  // hover tint for itself and for its sibling. Keep the colour in step with
  // INVOICE_TABLE_ROW_CLASS.
  return (
    <>
      <TableRow
        className={cn(
          INVOICE_TABLE_ROW_CLASS,
          rejected &&
            'border-b-0 has-[+tr:hover]:[background-color:var(--muted)]'
        )}
      >
        <TableCell className='max-w-[220px]'>
          {props.request.invoice_no ? (
            <TradeNoCell tradeNo={props.request.invoice_no} />
          ) : (
            <span className='text-muted-foreground'>—</span>
          )}
        </TableCell>
        <TableCell
          className='max-w-[220px] truncate'
          title={props.request.title}
        >
          {props.request.title}
        </TableCell>
        <TableCell className='font-medium'>
          {formatMinorAmount(
            props.request.amount_total,
            props.request.currency
          )}
        </TableCell>
        <TableCell>
          <StatusBadge
            label={t(statusConfig.labelKey)}
            variant={statusConfig.variant}
            copyable={false}
          />
        </TableCell>
        <TableCell className='text-muted-foreground'>
          {formatTimestampToDate(props.request.create_time)}
        </TableCell>
        <TableCell className='text-right'>
          <div className='flex justify-end gap-2'>
            {props.request.status === 'issued' && (
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => props.onDownload(props.request)}
              >
                <Download className='h-3.5 w-3.5' aria-hidden='true' />
                {t('Download')}
              </Button>
            )}
            {props.request.status === 'pending' && (
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={props.cancelling}
                onClick={() => props.onCancel(props.request)}
              >
                {t('Withdraw')}
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
      {rejected && (
        <TableRow
          className={cn(
            INVOICE_TABLE_ROW_CLASS,
            '[tr:hover+&]:[background-color:var(--muted)]'
          )}
        >
          <TableCell colSpan={6} className='pt-0 pb-3 whitespace-normal'>
            <div className='text-destructive flex items-start gap-2 text-xs'>
              <AlertCircle
                className='mt-0.5 h-3.5 w-3.5 shrink-0'
                aria-hidden='true'
              />
              <span>
                <span className='font-medium'>{t('Rejection Reason')}: </span>
                {props.request.reject_reason}
              </span>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
