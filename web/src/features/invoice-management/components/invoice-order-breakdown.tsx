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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTimestampToDate } from '@/lib/format'

import { formatInvoiceAmount, parseTradeNumbers } from '../lib'
import type { InvoiceItem, InvoiceRequest } from '../types'

type InvoiceOrderBreakdownProps = {
  request: InvoiceRequest
  /** Per-order lines from the detail endpoint. Absent while it is in flight. */
  items?: InvoiceItem[]
  isLoading?: boolean
}

/**
 * The orders one invoice covers, with the amount each contributed.
 *
 * A request can bundle several paid orders into a single invoice, and the row
 * only carries the comma-separated trade numbers — enough to know *that* it is a
 * merged invoice, not enough to check the arithmetic. The amounts come from
 * `invoice_items`, so this needs the detail endpoint; while that is in flight the
 * trade numbers from the snapshot are shown on their own rather than nothing.
 */
export function InvoiceOrderBreakdown(props: InvoiceOrderBreakdownProps) {
  const { t } = useTranslation()

  const snapshotNumbers = parseTradeNumbers(props.request.trade_no_snapshot)
  const lines =
    props.items && props.items.length > 0
      ? props.items.map((item) => ({
          tradeNo: item.trade_no,
          amount: formatInvoiceAmount(item.amount, item.currency),
          payTime:
            item.pay_time > 0 ? formatTimestampToDate(item.pay_time) : null,
        }))
      : snapshotNumbers.map((tradeNo) => ({
          tradeNo,
          amount: undefined,
          payTime: null,
        }))

  if (lines.length === 0) return null

  const total = formatInvoiceAmount(
    props.request.amount_total,
    props.request.currency
  )

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-muted-foreground text-xs sm:text-sm'>
          {lines.length > 1
            ? t('Covers {{count}} orders (merged invoice)', {
                count: lines.length,
              })
            : t('Covers {{count}} order', { count: lines.length })}
        </span>
        <CopyButton
          value={lines.map((line) => line.tradeNo).join('\n')}
          size='sm'
          className='size-7 p-0'
          iconClassName='size-3.5'
          tooltip={t('Copy all order numbers')}
          aria-label={t('Copy all order numbers')}
        />
      </div>

      <ul className='bg-background divide-border divide-y rounded-lg border'>
        {lines.map((line, index) => (
          <li
            key={line.tradeNo}
            className='flex items-center gap-2 px-2.5 py-1.5'
          >
            <span className='text-muted-foreground w-5 shrink-0 text-xs tabular-nums'>
              {index + 1}
            </span>
            <span className='min-w-0 flex-1'>
              <span className='block font-mono text-xs break-all sm:text-sm'>
                {line.tradeNo}
              </span>
              {line.payTime && (
                <span className='text-muted-foreground block text-xs'>
                  {t('Paid {{date}}', { date: line.payTime })}
                </span>
              )}
            </span>
            {props.isLoading && line.amount === undefined ? (
              <Skeleton className='h-4 w-16 shrink-0' />
            ) : (
              <span className='shrink-0 font-mono text-xs tabular-nums sm:text-sm'>
                {line.amount ?? '—'}
              </span>
            )}
            <CopyButton
              value={line.tradeNo}
              size='sm'
              className='size-7 p-0'
              iconClassName='size-3.5'
              tooltip={t('Copy order number')}
              aria-label={t('Copy order number')}
            />
          </li>
        ))}
      </ul>

      {lines.length > 1 && (
        <div className='flex items-center justify-between gap-2 px-2.5'>
          <span className='text-muted-foreground text-xs'>{t('Total')}</span>
          <span className='font-mono text-xs font-medium tabular-nums sm:text-sm'>
            {total}
          </span>
        </div>
      )}
    </div>
  )
}
