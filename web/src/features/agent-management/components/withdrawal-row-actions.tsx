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
import { BadgeCheck, BanknoteArrowUp, Eye, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { AgentWithdrawal } from '../types'
import { useAgents } from './agents-provider'

type WithdrawalRowActionsProps = {
  withdrawal: AgentWithdrawal
}

/**
 * Row actions for one withdrawal, keyed off where it sits in the payout flow.
 *
 * A request pending review offers approve/reject; one already approved offers
 * mark-paid/mark-failed. The two pairs never appear together, so an operator
 * cannot pay something that has not been reviewed. Flat buttons rather than a
 * dropdown, for the same jsdom reason as the agent table.
 */
export function WithdrawalRowActions(props: WithdrawalRowActionsProps) {
  const { t } = useTranslation()
  const { setOpen, setCurrentWithdrawal } = useAgents()

  const status = props.withdrawal.status
  const isPendingReview = status === 'pending'
  const isAwaitingPayment = status === 'approved'

  const openDialog = (dialog: Parameters<typeof setOpen>[0]) => {
    setCurrentWithdrawal(props.withdrawal)
    setOpen(dialog)
  }

  return (
    <div className='-ms-1.5 flex items-center gap-0.5'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='sm'
              className='size-7 p-0'
              aria-label={t('View withdrawal detail')}
              onClick={() => openDialog('withdrawal-detail')}
            />
          }
        >
          <Eye className='size-3.5' aria-hidden='true' />
        </TooltipTrigger>
        <TooltipContent>{t('View withdrawal detail')}</TooltipContent>
      </Tooltip>

      {isPendingReview && (
        <>
          <Button
            size='sm'
            className='h-7'
            onClick={() => openDialog('withdrawal-approve')}
          >
            <BadgeCheck className='size-3.5' aria-hidden='true' />
            {t('Approve')}
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-destructive hover:text-destructive size-7 p-0'
                  aria-label={t('Reject withdrawal')}
                  onClick={() => openDialog('withdrawal-reject')}
                />
              }
            >
              <XCircle className='size-3.5' aria-hidden='true' />
            </TooltipTrigger>
            <TooltipContent>{t('Reject withdrawal')}</TooltipContent>
          </Tooltip>
        </>
      )}

      {isAwaitingPayment && (
        <>
          <Button
            size='sm'
            className='h-7'
            onClick={() => openDialog('withdrawal-complete')}
          >
            <BanknoteArrowUp className='size-3.5' aria-hidden='true' />
            {t('Mark Paid')}
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-destructive hover:text-destructive size-7 p-0'
                  aria-label={t('Mark payout failed')}
                  onClick={() => openDialog('withdrawal-fail')}
                />
              }
            >
              <XCircle className='size-3.5' aria-hidden='true' />
            </TooltipTrigger>
            <TooltipContent>{t('Mark payout failed')}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  )
}
