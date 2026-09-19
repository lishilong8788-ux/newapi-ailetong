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
import { ArrowRightLeft, Banknote, ReceiptText, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'

import { formatAgentCurrency } from '../lib/format'
import { useAgent } from './agent-provider'

const WITHDRAW_HINT_ID = 'agent-withdraw-gate-hint'

function EarningsFigure(props: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className='min-w-0'>
      <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
        {props.label}
      </div>
      <div
        className={
          props.emphasis
            ? 'text-success mt-0.5 truncate text-lg font-semibold tabular-nums'
            : 'mt-0.5 truncate text-sm font-semibold tabular-nums'
        }
      >
        {props.value}
      </div>
    </div>
  )
}

/**
 * Earnings summary and the three money actions.
 *
 * Withdrawing is gated on `status === 'active'`. Only an approved agent reaches
 * this card at all, so the gate closes for exactly one reason — an operator
 * suspended the account. The buttons stay visible and disabled rather than
 * disappearing, so that reason can be stated next to them.
 */
export function EarningsCard() {
  const { t } = useTranslation()
  const { overview, isLoadingOverview, openWithdrawal, setOpen } = useAgent()

  if (isLoadingOverview && !overview) {
    return (
      <Card data-card-hover='false' className='py-0'>
        <CardContent className='space-y-3 p-4'>
          <Skeleton className='h-5 w-28' />
          <Skeleton className='h-10 w-40' />
          <div className='grid grid-cols-2 gap-3'>
            <Skeleton className='h-10' />
            <Skeleton className='h-10' />
          </div>
          <Skeleton className='h-9' />
        </CardContent>
      </Card>
    )
  }

  const stats = overview?.stats
  const canWithdraw = overview?.profile?.status === 'active'

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='space-y-3.5 p-4'>
        <div className='flex items-center gap-2.5'>
          <IconBadge tone='success'>
            <Wallet />
          </IconBadge>
          <h3 className='text-sm font-semibold'>{t('Commission Earnings')}</h3>
        </div>

        <EarningsFigure
          label={t('Available to Withdraw')}
          value={formatAgentCurrency(stats?.available ?? 0)}
          emphasis
        />

        <div className='grid grid-cols-2 gap-3 border-t pt-3'>
          <EarningsFigure
            label={t('Total Earned')}
            value={formatAgentCurrency(stats?.total ?? 0)}
          />
          <EarningsFigure
            label={t('Invited Customers')}
            value={String(stats?.customer_count ?? 0)}
          />
        </div>

        <div className='grid gap-2 border-t pt-3'>
          <Button
            className='w-full'
            size='sm'
            disabled={!canWithdraw}
            aria-describedby={canWithdraw ? undefined : WITHDRAW_HINT_ID}
            onClick={() => openWithdrawal('bank')}
          >
            <Banknote className='size-4' aria-hidden='true' />
            {t('Withdraw')}
          </Button>

          <div className='grid grid-cols-2 gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setOpen('withdrawals')}
            >
              <ReceiptText className='size-4' aria-hidden='true' />
              {t('Records')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={!canWithdraw}
              aria-describedby={canWithdraw ? undefined : WITHDRAW_HINT_ID}
              onClick={() => openWithdrawal('balance')}
            >
              <ArrowRightLeft className='size-4' aria-hidden='true' />
              {t('To Balance')}
            </Button>
          </div>

          {!canWithdraw && (
            <p
              id={WITHDRAW_HINT_ID}
              className='text-warning text-xs leading-relaxed'
            >
              {t(
                'This agent account is suspended. Commission you already earned stays in the ledger, but no new commission accrues and withdrawals are paused.'
              )}
            </p>
          )}
        </div>

        <button
          type='button'
          className='text-muted-foreground hover:text-foreground w-full text-start text-xs underline underline-offset-2'
          onClick={() => setOpen('commissions')}
        >
          {t('View commission ledger')}
        </button>
      </CardContent>
    </Card>
  )
}
