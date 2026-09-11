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
import { toast } from 'sonner'

import { sideDrawerContentClassName } from '@/components/drawer-layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatTimestampToDate } from '@/lib/format'

import { cancelAgentWithdrawal, listAgentWithdrawals } from '../../api'
import {
  AGENT_RECORDS_PAGE_SIZE,
  AGENT_WITHDRAWAL_METHOD_LABEL_KEYS,
  AGENT_WITHDRAWAL_STATUSES,
  CANCELLABLE_WITHDRAWAL_STATUSES,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../../constants'
import { formatAgentCurrency } from '../../lib/format'
import type { AgentWithdrawal } from '../../types'
import { useAgent } from '../agent-provider'
import { RecordsPager, RecordsPlaceholder, RecordRow } from './records-chrome'

export function WithdrawalsSheet() {
  const { t } = useTranslation()
  const { open, setOpen, refreshOverview } = useAgent()
  const [page, setPage] = useState(1)
  const [cancellingId, setCancellingId] = useState<number | null>(null)

  const isOpen = open === 'withdrawals'

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['agent-withdrawals', page],
    queryFn: async () => {
      const result = await listAgentWithdrawals({
        p: page,
        page_size: AGENT_RECORDS_PAGE_SIZE,
      })
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.WITHDRAWALS_FAILED))
        return { items: [], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    enabled: isOpen,
    placeholderData: (previousData) => previousData,
  })

  const handleCancel = async (withdrawal: AgentWithdrawal) => {
    setCancellingId(withdrawal.id)
    try {
      const result = await cancelAgentWithdrawal(withdrawal.id)
      if (!result.success) {
        toast.error(
          result.message || t(ERROR_MESSAGES.WITHDRAWAL_CANCEL_FAILED)
        )
        return
      }
      toast.success(t(SUCCESS_MESSAGES.WITHDRAWAL_CANCELLED))
      await refetch()
      refreshOverview()
    } finally {
      setCancellingId(null)
    }
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <Sheet open={isOpen} onOpenChange={(next) => !next && setOpen(null)}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-lg')}>
        <SheetHeader className='border-b px-4 py-3 text-start sm:px-6 sm:py-4'>
          <SheetTitle>{t('Withdrawal Records')}</SheetTitle>
          <SheetDescription>
            {t('Every request you have submitted, newest first.')}
          </SheetDescription>
        </SheetHeader>

        <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6'>
          <RecordsPlaceholder
            isLoading={isLoading}
            isEmpty={items.length === 0}
            emptyTitle={t('No Withdrawal Records')}
            emptyDescription={t('Your withdrawal requests will appear here.')}
          />

          {items.map((withdrawal) => {
            const statusConfig = AGENT_WITHDRAWAL_STATUSES[withdrawal.status]
            const canCancel = CANCELLABLE_WITHDRAWAL_STATUSES.includes(
              withdrawal.status
            )

            return (
              <article
                key={withdrawal.id}
                className='space-y-2 rounded-lg border p-3'
              >
                <div className='flex items-start justify-between gap-2'>
                  <div className='min-w-0'>
                    <div className='text-base font-semibold tabular-nums'>
                      {formatAgentCurrency(withdrawal.amount)}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {t(AGENT_WITHDRAWAL_METHOD_LABEL_KEYS[withdrawal.method])}
                    </div>
                  </div>
                  {statusConfig ? (
                    <StatusBadge
                      label={t(statusConfig.labelKey)}
                      variant={statusConfig.variant}
                      copyable={false}
                    />
                  ) : null}
                </div>

                <div className='space-y-1 border-t pt-2'>
                  <RecordRow label={t('Processing Fee')}>
                    {formatAgentCurrency(withdrawal.fee)}
                  </RecordRow>
                  <RecordRow label={t('You Receive')}>
                    {formatAgentCurrency(withdrawal.actual_amount)}
                  </RecordRow>
                  <RecordRow label={t('Requested At')}>
                    {formatTimestampToDate(withdrawal.create_time)}
                  </RecordRow>
                  {withdrawal.pay_time > 0 && (
                    <RecordRow label={t('Paid At')}>
                      {formatTimestampToDate(withdrawal.pay_time)}
                    </RecordRow>
                  )}
                  {withdrawal.pay_voucher ? (
                    <RecordRow label={t('Payment Reference')}>
                      <span className='font-mono'>
                        {withdrawal.pay_voucher}
                      </span>
                    </RecordRow>
                  ) : null}
                </div>

                {withdrawal.reject_reason ? (
                  <p className='text-destructive text-xs'>
                    {t('Reason')}: {withdrawal.reject_reason}
                  </p>
                ) : null}

                {canCancel && (
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={cancellingId === withdrawal.id}
                    onClick={() => void handleCancel(withdrawal)}
                  >
                    {cancellingId === withdrawal.id
                      ? t('Processing...')
                      : t('Cancel Request')}
                  </Button>
                )}
              </article>
            )
          })}
        </div>

        <RecordsPager
          page={page}
          pageSize={AGENT_RECORDS_PAGE_SIZE}
          total={total}
          onPageChange={setPage}
        />
      </SheetContent>
    </Sheet>
  )
}
