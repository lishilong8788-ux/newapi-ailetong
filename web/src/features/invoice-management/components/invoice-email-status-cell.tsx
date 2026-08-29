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

import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestampToDate } from '@/lib/format'

import type { InvoiceRequest } from '../types'
import { InvoiceResendEmailButton } from './invoice-resend-email-button'

type InvoiceEmailStatusCellProps = {
  request: InvoiceRequest
}

/**
 * Delivery state of the customer notification. SMTP failures are common enough
 * that the failure reason and a retry have to live on the row itself — without
 * them an operator cannot tell a silent bounce from a healthy send.
 */
export function InvoiceEmailStatusCell(props: InvoiceEmailStatusCellProps) {
  const { t } = useTranslation()

  if (props.request.status !== 'issued') {
    return <span className='text-muted-foreground text-sm'>-</span>
  }

  if (props.request.email_error) {
    return (
      <div className='flex items-center gap-1'>
        <Tooltip>
          <TooltipTrigger
            render={
              <StatusBadge
                label={t('Send Failed')}
                variant='danger'
                copyable={false}
                className='cursor-help'
              />
            }
          />
          <TooltipContent className='max-w-xs'>
            <p className='text-xs break-words'>{props.request.email_error}</p>
          </TooltipContent>
        </Tooltip>
        <InvoiceResendEmailButton requestId={props.request.id} />
      </div>
    )
  }

  if (props.request.email_sent_at > 0) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <StatusBadge
              label={t('Sent')}
              variant='success'
              copyable={false}
              className='cursor-help'
            />
          }
        />
        <TooltipContent>
          <p className='text-xs'>
            {formatTimestampToDate(props.request.email_sent_at)}
          </p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className='flex items-center gap-1'>
      <StatusBadge label={t('Not Sent')} variant='neutral' copyable={false} />
      <InvoiceResendEmailButton requestId={props.request.id} />
    </div>
  )
}
