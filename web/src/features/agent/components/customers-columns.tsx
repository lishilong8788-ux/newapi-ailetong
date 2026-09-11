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
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import { formatAgentCurrency } from '../lib/format'
import type { AgentCustomer } from '../types'

/** Backend user status: 1 enabled, anything else is not usable. */
const USER_STATUS_ENABLED = 1

/**
 * Columns for the agent's own customer list.
 *
 * Deliberately absent: email, phone, API keys, request logs. An agent is an
 * external partner, not staff (design doc §13.2) — the endpoint does not send
 * those fields and this table must not grow a column that expects them.
 */
export function useCustomersColumns(): ColumnDef<AgentCustomer>[] {
  const { t } = useTranslation()

  return [
    {
      id: 'user',
      header: t('Customer'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='min-w-0 space-y-0.5'>
          <div className='truncate text-sm font-medium'>
            {row.original.display_name || row.original.username}
          </div>
          <div className='text-muted-foreground truncate font-mono text-xs'>
            {row.original.username}
          </div>
        </div>
      ),
      enableSorting: false,
      size: 200,
    },
    {
      accessorKey: 'created_at',
      header: t('Invited At'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='font-mono text-sm whitespace-nowrap'>
          {formatTimestampToDate(row.original.created_at)}
        </span>
      ),
      enableSorting: false,
      size: 170,
    },
    {
      accessorKey: 'topup_total',
      header: t('Total Topup'),
      cell: ({ row }) => (
        <span className='text-sm font-medium tabular-nums'>
          {formatAgentCurrency(row.original.topup_total)}
        </span>
      ),
      enableSorting: false,
      size: 130,
    },
    {
      accessorKey: 'quota',
      header: t('Remaining Quota'),
      cell: ({ row }) => (
        <span className='text-sm tabular-nums'>
          {formatQuota(row.original.quota)}
        </span>
      ),
      enableSorting: false,
      size: 130,
    },
    {
      accessorKey: 'used_quota',
      header: t('Total Usage'),
      cell: ({ row }) => (
        <span className='text-sm tabular-nums'>
          {formatQuota(row.original.used_quota)}
        </span>
      ),
      enableSorting: false,
      size: 130,
    },
    {
      accessorKey: 'commission_total',
      header: t('Total Commission'),
      cell: ({ row }) => (
        <span className='text-success text-sm font-semibold tabular-nums'>
          {formatAgentCurrency(row.original.commission_total)}
        </span>
      ),
      enableSorting: false,
      size: 140,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const isEnabled = row.original.status === USER_STATUS_ENABLED
        return (
          <StatusBadge
            label={isEnabled ? t('Enabled') : t('Disabled')}
            variant={isEnabled ? 'success' : 'neutral'}
            copyable={false}
            className='-ms-1.5'
          />
        )
      },
      enableSorting: false,
      size: 110,
    },
  ]
}
