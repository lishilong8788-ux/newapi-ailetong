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
import { Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimestampToDate } from '@/lib/format'

import { ERROR_MESSAGES } from '../constants'
import { getOrderKey } from '../hooks'
import { formatMinorAmount } from '../lib'
import type { InvoiceableOrder } from '../types'
import {
  INVOICE_TABLE_CLASS,
  INVOICE_TABLE_HEADER_ROW_CLASS,
  INVOICE_TABLE_ROW_CLASS,
  InvoiceTableEmptyRow,
} from './invoice-table-chrome'
import { InvoiceTableSkeleton } from './invoice-table-skeleton'
import { TradeNoCell } from './trade-no-cell'

interface PendingOrdersTabProps {
  orders: InvoiceableOrder[]
  loading: boolean
  selectedKeys: string[]
  selectedCount: number
  mixedCurrency: boolean
  onToggleOrder: (order: InvoiceableOrder) => void
  onToggleAll: () => void
  onRequestSingle: (order: InvoiceableOrder) => void
}

export function PendingOrdersTab(props: PendingOrdersTabProps) {
  const { t } = useTranslation()
  const allSelected =
    props.orders.length > 0 && props.selectedCount === props.orders.length

  if (props.loading) {
    return <InvoiceTableSkeleton columns={5} />
  }

  return (
    <div>
      {props.mixedCurrency && (
        <div className='px-4 pt-4'>
          <Alert variant='destructive'>
            <AlertDescription>
              {t(ERROR_MESSAGES.MIXED_CURRENCY)}{' '}
              {t('One invoice can only cover a single currency.')}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <Table className={INVOICE_TABLE_CLASS}>
        <TableHeader>
          <TableRow className={INVOICE_TABLE_HEADER_ROW_CLASS}>
            <TableHead className='w-10'>
              <Checkbox
                checked={allSelected}
                indeterminate={props.selectedCount > 0 && !allSelected}
                onCheckedChange={props.onToggleAll}
                aria-label={t('Select all orders')}
                disabled={props.orders.length === 0}
              />
            </TableHead>
            <TableHead>{t('Order Number')}</TableHead>
            <TableHead>{t('Payment Amount')}</TableHead>
            <TableHead>{t('Payment Time')}</TableHead>
            <TableHead className='text-right'>{t('Actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.orders.length === 0 && (
            <InvoiceTableEmptyRow
              colSpan={5}
              icon={Inbox}
              title={t('No orders awaiting invoicing')}
              description={t(
                'Paid orders become available here once payment is confirmed.'
              )}
            />
          )}
          {props.orders.map((order) => {
            const key = getOrderKey(order)
            const selected = props.selectedKeys.includes(key)
            return (
              <TableRow
                key={key}
                className={INVOICE_TABLE_ROW_CLASS}
                data-state={selected ? 'selected' : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => props.onToggleOrder(order)}
                    aria-label={t('Select order {{tradeNo}}', {
                      tradeNo: order.trade_no,
                    })}
                  />
                </TableCell>
                <TableCell className='max-w-[240px]'>
                  <TradeNoCell tradeNo={order.trade_no} />
                </TableCell>
                <TableCell className='font-medium tabular-nums'>
                  {formatMinorAmount(order.amount, order.currency)}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {formatTimestampToDate(order.pay_time)}
                </TableCell>
                <TableCell className='text-right'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => props.onRequestSingle(order)}
                  >
                    {t('Apply for Invoice')}
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
