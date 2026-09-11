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

import { WITHDRAWAL_METHOD_LABEL_KEYS, WITHDRAWAL_STATUSES } from '../constants'
import { formatCommissionAmount, formatWithdrawalNo } from '../lib/format'
import type { AgentWithdrawal } from '../types'
import { WithdrawalRowActions } from './withdrawal-row-actions'

export function useWithdrawalsColumns(): ColumnDef<AgentWithdrawal>[] {
  const { t } = useTranslation()

  return [
    {
      accessorKey: 'id',
      header: t('Withdrawal No.'),
      cell: ({ row }) => (
        <span className='font-mono text-xs tabular-nums'>
          {formatWithdrawalNo(row.original.id)}
        </span>
      ),
      enableSorting: false,
      size: 120,
    },
    {
      id: 'agent',
      header: t('Agent'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='min-w-0 space-y-0.5'>
          <div className='truncate text-sm font-medium'>
            {row.original.username ||
              row.original.display_name ||
              `#${row.original.agent_user_id}`}
          </div>
          <div className='text-muted-foreground font-mono text-xs tabular-nums'>
            #{row.original.agent_user_id}
          </div>
        </div>
      ),
      enableSorting: false,
      size: 150,
    },
    {
      accessorKey: 'amount',
      header: t('Requested'),
      cell: ({ row }) => (
        <span className='text-sm font-medium tabular-nums'>
          {formatCommissionAmount(row.original.amount)}
        </span>
      ),
      enableSorting: false,
      size: 120,
    },
    {
      accessorKey: 'fee',
      header: t('Fee'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='text-muted-foreground text-sm tabular-nums'>
          {formatCommissionAmount(row.original.fee)}
        </span>
      ),
      enableSorting: false,
      size: 100,
    },
    {
      accessorKey: 'actual_amount',
      header: t('Net Payout'),
      cell: ({ row }) => (
        <span className='text-sm font-semibold tabular-nums'>
          {formatCommissionAmount(row.original.actual_amount)}
        </span>
      ),
      enableSorting: false,
      size: 120,
    },
    {
      accessorKey: 'method',
      header: t('Method'),
      cell: ({ row }) => (
        <span className='text-sm'>
          {t(
            WITHDRAWAL_METHOD_LABEL_KEYS[row.original.method] ??
              WITHDRAWAL_METHOD_LABEL_KEYS.bank
          )}
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
          WITHDRAWAL_STATUSES[row.original.status] ??
          WITHDRAWAL_STATUSES.pending
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
      size: 130,
    },
    {
      accessorKey: 'create_time',
      header: t('Submitted At'),
      cell: ({ row }) => (
        <div className='min-w-[150px] font-mono text-sm'>
          {formatTimestampToDate(row.original.create_time)}
        </div>
      ),
      enableSorting: false,
      size: 170,
    },
    {
      accessorKey: 'audit_by',
      header: t('Reviewer'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='text-muted-foreground font-mono text-xs tabular-nums'>
          {row.original.audit_by > 0 ? `#${row.original.audit_by}` : '—'}
        </span>
      ),
      enableSorting: false,
      size: 100,
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      cell: ({ row }) => <WithdrawalRowActions withdrawal={row.original} />,
      meta: { pinned: 'right' as const },
      size: 200,
    },
  ]
}
