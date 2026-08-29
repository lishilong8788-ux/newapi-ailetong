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

import { SideDrawerSection } from '@/components/drawer-layout'
import { formatTimestampToDate } from '@/lib/format'

import { getOrderKey } from '../../hooks'
import { formatMinorAmount } from '../../lib'
import type { InvoiceableOrder } from '../../types'

interface InvoiceRequestOrderSummaryProps {
  orders: InvoiceableOrder[]
  totalMinor: number
  currency: string | null
}

/** Read-only recap of the orders that this invoice will cover. */
export function InvoiceRequestOrderSummary(
  props: InvoiceRequestOrderSummaryProps
) {
  const { t } = useTranslation()

  return (
    <SideDrawerSection>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold tracking-tight'>
          {t('Selected Orders')}
        </h3>
        <span className='text-muted-foreground text-xs'>
          {t('{{count}} selected', { count: props.orders.length })}
        </span>
      </div>

      <ul className='divide-border/60 max-h-52 divide-y overflow-y-auto rounded-lg border'>
        {props.orders.map((order) => (
          <li
            key={getOrderKey(order)}
            className='flex items-center justify-between gap-3 px-3 py-2'
          >
            <div className='min-w-0'>
              <code className='block truncate font-mono text-xs'>
                {order.trade_no}
              </code>
              <span className='text-muted-foreground text-xs'>
                {formatTimestampToDate(order.pay_time)}
              </span>
            </div>
            <span className='shrink-0 text-sm font-medium'>
              {formatMinorAmount(order.amount, order.currency)}
            </span>
          </li>
        ))}
      </ul>

      <div className='flex items-center justify-between border-t pt-2'>
        <span className='text-muted-foreground text-sm'>{t('Total')}</span>
        <span className='text-base font-semibold'>
          {formatMinorAmount(props.totalMinor, props.currency)}
        </span>
      </div>
    </SideDrawerSection>
  )
}
