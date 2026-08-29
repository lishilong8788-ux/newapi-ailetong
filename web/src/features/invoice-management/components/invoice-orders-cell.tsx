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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

import { getInvoiceRequest } from '../api'
import { parseTradeNumbers } from '../lib'
import type { InvoiceRequest } from '../types'
import { InvoiceOrderBreakdown } from './invoice-order-breakdown'

type InvoiceOrdersCellProps = {
  request: InvoiceRequest
}

/**
 * Order count that opens the orders the invoice covers, with what each one
 * contributed. A popover rather than a tooltip: the numbers are the thing an
 * operator reconciles against the payment platform, so they must survive a click
 * and stay copyable.
 *
 * The amounts come from `invoice_items`, which the list endpoint omits, so they
 * are fetched when the popover first opens — one request per inspected row
 * instead of one per rendered row.
 */
export function InvoiceOrdersCell(props: InvoiceOrdersCellProps) {
  const { t } = useTranslation()
  const [hasOpened, setHasOpened] = useState(false)
  const tradeNumbers = parseTradeNumbers(props.request.trade_no_snapshot)

  const { data: detail, isLoading } = useQuery({
    queryKey: ['invoice-request-detail', props.request.id],
    queryFn: async () => {
      const result = await getInvoiceRequest(props.request.id)
      return result.success ? (result.data ?? null) : null
    },
    enabled: hasOpened,
    staleTime: 30_000,
  })

  if (tradeNumbers.length === 0) {
    return <span className='text-muted-foreground text-sm'>-</span>
  }

  return (
    <Popover onOpenChange={(open) => open && setHasOpened(true)}>
      <PopoverTrigger
        render={
          <Button variant='ghost' size='sm' className='-ms-2 font-normal' />
        }
      >
        {tradeNumbers.length > 1
          ? t('{{count}} orders · merged', { count: tradeNumbers.length })
          : t('{{count}} order(s)', { count: tradeNumbers.length })}
      </PopoverTrigger>
      <PopoverContent className='max-h-80 w-80 overflow-y-auto p-2'>
        <InvoiceOrderBreakdown
          request={props.request}
          items={detail?.items}
          isLoading={isLoading}
        />
      </PopoverContent>
    </Popover>
  )
}
