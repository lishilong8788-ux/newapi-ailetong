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
import type { Table as TanstackTable } from '@tanstack/react-table'
import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import { formatAgentCurrency } from '../lib/format'
import type { AgentCustomer } from '../types'

const USER_STATUS_ENABLED = 1

const MOBILE_SKELETON_KEYS = [
  'agent-customer-skeleton-1',
  'agent-customer-skeleton-2',
  'agent-customer-skeleton-3',
  'agent-customer-skeleton-4',
  'agent-customer-skeleton-5',
]

function CustomersMobileSkeleton() {
  return (
    <div className='divide-border'>
      {MOBILE_SKELETON_KEYS.map((key) => (
        <div
          key={key}
          className='space-y-2 border-b px-4 py-2.5 last:border-b-0'
        >
          <div className='flex items-center justify-between'>
            <Skeleton className='h-4 w-32' />
            <Skeleton className='h-5 w-16 rounded-md' />
          </div>
          <Skeleton className='h-3 w-24' />
          <div className='flex items-center justify-between gap-3'>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-4 w-20' />
          </div>
        </div>
      ))}
    </div>
  )
}

function CustomerCardRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-2 text-xs'>
      <span className='text-muted-foreground shrink-0'>{props.label}</span>
      <div className='flex min-w-0 items-center justify-end'>
        {props.children}
      </div>
    </div>
  )
}

type CustomersMobileListProps = {
  table: TanstackTable<AgentCustomer>
  isLoading: boolean
}

/**
 * Phone rendering of the customer list. Seven columns cannot be read on a
 * phone, so each customer becomes a card — same data, stacked.
 */
export function CustomersMobileList(props: CustomersMobileListProps) {
  const { t } = useTranslation()
  const rows = props.table.getRowModel().rows

  if (props.isLoading) return <CustomersMobileSkeleton />

  if (!rows.length) {
    return (
      <div className='p-8'>
        <Empty className='border-none p-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Users className='size-6' />
            </EmptyMedia>
            <EmptyTitle>{t('No Customers Yet')}</EmptyTitle>
            <EmptyDescription>
              {t('Share your promo link to start inviting customers.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className='divide-border'>
      {rows.map((row) => {
        const customer = row.original
        const isEnabled = customer.status === USER_STATUS_ENABLED

        return (
          <div
            key={row.id}
            className='bg-card space-y-2 border-b px-4 py-2.5 transition-colors last:border-b-0 hover:[background-color:var(--muted)]'
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-semibold'>
                  {customer.display_name || customer.username}
                </div>
                <div className='text-muted-foreground truncate font-mono text-[11px]'>
                  {customer.username}
                </div>
              </div>
              <StatusBadge
                label={isEnabled ? t('Enabled') : t('Disabled')}
                variant={isEnabled ? 'success' : 'neutral'}
                copyable={false}
              />
            </div>

            <CustomerCardRow label={t('Total Topup')}>
              <span className='font-medium tabular-nums'>
                {formatAgentCurrency(customer.topup_total)}
              </span>
            </CustomerCardRow>

            <CustomerCardRow label={t('Total Commission')}>
              <span className='text-success font-semibold tabular-nums'>
                {formatAgentCurrency(customer.commission_total)}
              </span>
            </CustomerCardRow>

            <CustomerCardRow label={t('Remaining Quota')}>
              <span className='tabular-nums'>
                {formatQuota(customer.quota)}
              </span>
            </CustomerCardRow>

            <CustomerCardRow label={t('Total Usage')}>
              <span className='tabular-nums'>
                {formatQuota(customer.used_quota)}
              </span>
            </CustomerCardRow>

            <div className='text-muted-foreground pt-0.5 font-mono text-[11px]'>
              {formatTimestampToDate(customer.created_at)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
