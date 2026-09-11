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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatTimestampToDate } from '@/lib/format'

import { listAgentCommissions } from '../../api'
import {
  AGENT_COMMISSION_STATUSES,
  AGENT_COMMISSION_STATUS_ALL,
  AGENT_COMMISSION_STATUS_FILTERS,
  AGENT_RECORDS_PAGE_SIZE,
  ERROR_MESSAGES,
} from '../../constants'
import { formatAgentCurrency, formatCommissionRate } from '../../lib/format'
import { useAgent } from '../agent-provider'
import { RecordsPager, RecordsPlaceholder, RecordRow } from './records-chrome'

/** Tab labels reuse the ledger status labels, plus the "all" sentinel. */
const FILTER_LABEL_KEYS: Record<string, string> = {
  [AGENT_COMMISSION_STATUS_ALL]: 'All',
  pending: AGENT_COMMISSION_STATUSES.pending.labelKey,
  settled: AGENT_COMMISSION_STATUSES.settled.labelKey,
  frozen: AGENT_COMMISSION_STATUSES.frozen.labelKey,
  paid: AGENT_COMMISSION_STATUSES.paid.labelKey,
}

export function CommissionsSheet() {
  const { t } = useTranslation()
  const { open, setOpen } = useAgent()
  const [statusFilter, setStatusFilter] = useState<string>(
    AGENT_COMMISSION_STATUS_ALL
  )
  const [page, setPage] = useState(1)

  const isOpen = open === 'commissions'
  const requestStatus =
    statusFilter === AGENT_COMMISSION_STATUS_ALL ? '' : statusFilter

  const { data, isLoading } = useQuery({
    queryKey: ['agent-commissions', page, requestStatus],
    queryFn: async () => {
      const result = await listAgentCommissions({
        p: page,
        page_size: AGENT_RECORDS_PAGE_SIZE,
        status: requestStatus,
      })
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.COMMISSIONS_FAILED))
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

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <Sheet open={isOpen} onOpenChange={(next) => !next && setOpen(null)}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-lg')}>
        <SheetHeader className='border-b px-4 py-3 text-start sm:px-6 sm:py-4'>
          <SheetTitle>{t('Commission Ledger')}</SheetTitle>
          <SheetDescription>
            {t(
              'Every commission entry, including the rate applied at the time.'
            )}
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value)
            setPage(1)
          }}
          className='min-h-0 flex-1 gap-0 overflow-hidden'
        >
          <div className='shrink-0 border-b px-4 py-2.5 sm:px-6'>
            <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
              {AGENT_COMMISSION_STATUS_FILTERS.map((filter) => (
                <TabsTrigger key={filter} value={filter} className='px-3'>
                  {t(FILTER_LABEL_KEYS[filter])}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6'>
            <RecordsPlaceholder
              isLoading={isLoading}
              isEmpty={items.length === 0}
              emptyTitle={t('No Commission Entries')}
              emptyDescription={t(
                'Commission appears here once a customer you invited tops up.'
              )}
            />

            {items.map((commission) => {
              const statusConfig = AGENT_COMMISSION_STATUSES[commission.status]

              return (
                <article
                  key={commission.id}
                  className='space-y-2 rounded-lg border p-3'
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <div className='text-success text-base font-semibold tabular-nums'>
                        {formatAgentCurrency(commission.amount)}
                      </div>
                      <div className='text-muted-foreground truncate text-xs'>
                        {commission.from_username ||
                          t('User {{id}}', { id: commission.from_user_id })}
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
                    <RecordRow label={t('Commission Base')}>
                      {formatAgentCurrency(commission.base_amount)}
                    </RecordRow>
                    <RecordRow label={t('Rate Applied')}>
                      {formatCommissionRate(commission.rate)}
                    </RecordRow>
                    <RecordRow label={t('Recorded At')}>
                      {formatTimestampToDate(commission.create_time)}
                    </RecordRow>
                    {commission.status === 'pending' &&
                    commission.available_time > 0 ? (
                      <RecordRow label={t('Withdrawable From')}>
                        {formatTimestampToDate(commission.available_time)}
                      </RecordRow>
                    ) : null}
                  </div>

                  {commission.remark ? (
                    <p className='text-muted-foreground text-xs'>
                      {commission.remark}
                    </p>
                  ) : null}
                </article>
              )
            })}
          </div>
        </Tabs>

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
