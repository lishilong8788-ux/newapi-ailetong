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
import { ExternalLink, FileCheck2, Send, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { resendInvoiceEmail } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import type { InvoiceRequest } from '../types'
import { useInvoices } from './invoices-provider'

type DataTableRowActionsProps = {
  request: InvoiceRequest
}

export function DataTableRowActions(props: DataTableRowActionsProps) {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow, triggerRefresh } = useInvoices()
  const [isWorking, setIsWorking] = useState(false)

  const status = props.request.status
  const isActionable = status === 'pending'
  const canResend = status === 'issued' && !!props.request.email_error

  const runAction = async (
    action: () => Promise<{ success: boolean; message?: string }>,
    successKey: string,
    errorKey: string
  ) => {
    setIsWorking(true)
    try {
      const result = await action()
      if (!result.success) {
        toast.error(result.message || t(errorKey))
        return
      }
      toast.success(t(successKey))
      triggerRefresh()
    } finally {
      setIsWorking(false)
    }
  }

  if (isActionable) {
    return (
      <div className='-ms-1.5 flex items-center gap-1'>
        <Button
          size='sm'
          onClick={() => {
            setCurrentRow(props.request)
            setOpen('issue')
          }}
        >
          <FileCheck2 className='size-3.5' />
          {t('Issue Invoice')}
        </Button>

        <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onClick={() => {
              setCurrentRow(props.request)
              setOpen('reject')
            }}
          >
            {t('Reject')}
            <DropdownMenuShortcut>
              <XCircle size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DataTableRowActionMenu>
      </div>
    )
  }

  if (status === 'issued') {
    return (
      <div className='-ms-1.5 flex items-center gap-1'>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='sm'
                className='size-7 p-0'
                disabled={!props.request.pdf_url}
                aria-label={t('View PDF')}
                render={
                  <a
                    href={props.request.pdf_url || undefined}
                    target='_blank'
                    rel='noreferrer'
                  />
                }
              />
            }
          >
            <ExternalLink className='size-3.5' />
          </TooltipTrigger>
          <TooltipContent>{t('View PDF')}</TooltipContent>
        </Tooltip>

        {canResend && (
          <Button
            variant='outline'
            size='sm'
            disabled={isWorking}
            onClick={() =>
              runAction(
                () => resendInvoiceEmail(props.request.id),
                SUCCESS_MESSAGES.EMAIL_RESENT,
                ERROR_MESSAGES.RESEND_FAILED
              )
            }
          >
            <Send className='size-3.5' />
            {t('Resend Email')}
          </Button>
        )}
      </div>
    )
  }

  return <span className='text-muted-foreground text-sm'>-</span>
}
