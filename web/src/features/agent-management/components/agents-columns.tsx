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
import { Checkbox } from '@/components/ui/checkbox'
import { formatTimestampToDate } from '@/lib/format'

import { AGENT_STATUSES, AGENT_TYPE_LABEL_KEYS } from '../constants'
import {
  formatCommissionAmount,
  formatCommissionRate,
  maskBankAccount,
} from '../lib/format'
import type { AgentListItem } from '../types'
import { AgentRowActions } from './agent-row-actions'

export function useAgentsColumns(): ColumnDef<AgentListItem>[] {
  const { t } = useTranslation()

  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label={t('Select all agents')}
          className='translate-y-[2px]'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={t('Select agent')}
          className='translate-y-[2px]'
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
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
              `#${row.original.user_id}`}
          </div>
          <div className='text-muted-foreground font-mono text-xs tabular-nums'>
            #{row.original.user_id}
          </div>
        </div>
      ),
      enableSorting: false,
      size: 160,
    },
    {
      accessorKey: 'agent_type',
      header: t('Type'),
      cell: ({ row }) => (
        <span className='text-sm'>
          {t(
            AGENT_TYPE_LABEL_KEYS[row.original.agent_type] ??
              AGENT_TYPE_LABEL_KEYS.personal
          )}
        </span>
      ),
      enableSorting: false,
      size: 90,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const config =
          AGENT_STATUSES[row.original.status] ?? AGENT_STATUSES.incomplete
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
      size: 120,
    },
    {
      accessorKey: 'commission_rate',
      header: t('Commission Rate'),
      cell: ({ row }) => {
        const rate = formatCommissionRate(row.original.commission_rate)
        if (rate === null) {
          return (
            <span className='text-muted-foreground text-sm'>
              {t('Global default')}
            </span>
          )
        }
        return <span className='text-sm font-medium tabular-nums'>{rate}</span>
      },
      enableSorting: false,
      size: 130,
    },
    {
      accessorKey: 'customer_count',
      header: t('Customers'),
      cell: ({ row }) => (
        <span className='text-sm tabular-nums'>
          {row.original.customer_count ?? 0}
        </span>
      ),
      enableSorting: false,
      size: 100,
    },
    {
      accessorKey: 'agent_commission_total',
      header: t('Total Commission'),
      cell: ({ row }) => (
        <span className='text-sm font-medium tabular-nums'>
          {formatCommissionAmount(row.original.agent_commission_total)}
        </span>
      ),
      enableSorting: false,
      size: 140,
    },
    {
      accessorKey: 'agent_commission_available',
      header: t('Pending Payout'),
      cell: ({ row }) => (
        <span className='text-sm tabular-nums'>
          {formatCommissionAmount(row.original.agent_commission_available)}
        </span>
      ),
      enableSorting: false,
      size: 130,
    },
    {
      accessorKey: 'agent_withdrawn_total',
      header: t('Withdrawn'),
      cell: ({ row }) => (
        <span className='text-muted-foreground text-sm tabular-nums'>
          {formatCommissionAmount(row.original.agent_withdrawn_total)}
        </span>
      ),
      enableSorting: false,
      size: 120,
    },
    {
      id: 'bank_account',
      header: t('Bank Account'),
      meta: { mobileHidden: true },
      // Masked by the server and masked again here: the list is a browsing
      // surface, and only the withdrawal detail sheet has a reason to show a
      // payable account number.
      cell: ({ row }) => (
        <span className='text-muted-foreground font-mono text-xs'>
          {maskBankAccount(row.original.bank_account)}
        </span>
      ),
      enableSorting: false,
      size: 120,
    },
    {
      accessorKey: 'created_at',
      header: t('Applied At'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <div className='min-w-[150px] font-mono text-sm'>
          {formatTimestampToDate(row.original.created_at)}
        </div>
      ),
      enableSorting: false,
      size: 170,
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      cell: ({ row }) => <AgentRowActions agent={row.original} />,
      meta: { pinned: 'right' as const },
      size: 210,
    },
  ]
}
