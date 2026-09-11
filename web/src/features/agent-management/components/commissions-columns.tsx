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
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  COMMISSION_SOURCE_TYPE_LABEL_KEYS,
  COMMISSION_STATUSES,
} from '../constants'
import {
  formatAgentIdentity,
  formatCommissionAmount,
  formatCommissionRate,
} from '../lib/format'
import type { AgentCommission } from '../types'

export function useCommissionsColumns(): ColumnDef<AgentCommission>[] {
  const { t } = useTranslation()

  return [
    {
      accessorKey: 'create_time',
      header: t('Time'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='min-w-[150px] font-mono text-sm'>
          {formatTimestampToDate(row.original.create_time)}
        </div>
      ),
      enableSorting: false,
      size: 170,
    },
    {
      id: 'agent',
      header: t('Agent'),
      cell: ({ row }) => (
        <span className='truncate text-sm'>
          {formatAgentIdentity(
            row.original.username || row.original.display_name,
            row.original.agent_user_id
          )}
        </span>
      ),
      enableSorting: false,
      size: 150,
    },
    {
      id: 'from_user',
      header: t('Source Customer'),
      cell: ({ row }) => (
        <span className='truncate text-sm'>
          {row.original.from_user_id > 0
            ? formatAgentIdentity(
                row.original.from_username,
                row.original.from_user_id
              )
            : '—'}
        </span>
      ),
      enableSorting: false,
      size: 150,
    },
    {
      id: 'source',
      header: t('Source Order'),
      cell: ({ row }) => (
        <div className='min-w-0 space-y-0.5'>
          <div className='text-sm'>
            {t(
              COMMISSION_SOURCE_TYPE_LABEL_KEYS[row.original.source_type] ??
                COMMISSION_SOURCE_TYPE_LABEL_KEYS.topup
            )}
          </div>
          <div className='text-muted-foreground font-mono text-xs tabular-nums'>
            {row.original.source_id > 0 ? `#${row.original.source_id}` : '—'}
          </div>
        </div>
      ),
      enableSorting: false,
      size: 150,
    },
    {
      accessorKey: 'base_amount',
      header: t('Base Amount'),
      cell: ({ row }) => (
        <span className='text-sm tabular-nums'>
          {formatCommissionAmount(row.original.base_amount)}
        </span>
      ),
      enableSorting: false,
      size: 120,
    },
    {
      accessorKey: 'rate',
      header: t('Rate'),
      cell: ({ row }) => (
        <span className='text-sm tabular-nums'>
          {formatCommissionRate(row.original.rate) ?? '—'}
        </span>
      ),
      enableSorting: false,
      size: 90,
    },
    {
      accessorKey: 'amount',
      header: t('Commission'),
      cell: ({ row }) => (
        // A negative row is a reversal or a clawback. Colouring it makes the
        // direction of the entry readable at a glance in a long ledger.
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            row.original.amount < 0 && 'text-destructive'
          )}
        >
          {formatCommissionAmount(row.original.amount)}
        </span>
      ),
      enableSorting: false,
      size: 130,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const config =
          COMMISSION_STATUSES[row.original.status] ??
          COMMISSION_STATUSES.pending
        return (
          <StatusBadge
            label={t(config.labelKey)}
            variant={config.variant}
            copyable={false}
            className='-ms-1.5'
          />
        )
      },
      enableSorting: false,
      size: 140,
    },
    {
      accessorKey: 'remark',
      header: t('Remark'),
      cell: ({ row }) => (
        <span className='text-muted-foreground line-clamp-2 text-xs'>
          {row.original.remark || '—'}
        </span>
      ),
      enableSorting: false,
      size: 200,
    },
  ]
}
