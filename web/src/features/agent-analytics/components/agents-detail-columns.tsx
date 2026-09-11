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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableColumnHeader } from '@/components/data-table'

import {
  agentLabel,
  computeEffectiveRate,
  computePayingRate,
  formatCommissionDate,
  formatCount,
  formatRate,
  formatRmb,
  safeRate,
} from '../lib'
import type { AgentAnalyticsRow } from '../types'
import { LastCommissionCell, MetricCell } from './agent-metric-cells'

/**
 * Columns for the per-agent detail table.
 *
 * Every metric plotted in the four charts appears here as text: a canvas chart is
 * not an accessible presentation of data, and this table is the readable form of
 * the same numbers.
 *
 * The rate and average columns sort on values recomputed from the row's own
 * counts rather than the API's precomputed fields, so sorting can never disagree
 * with the figure rendered in the neighbouring cell.
 */
export function useAgentsDetailColumns(
  nowSeconds: number
): ColumnDef<AgentAnalyticsRow, unknown>[] {
  const { t } = useTranslation()

  return useMemo(
    () => [
      {
        id: 'agent',
        accessorFn: (row) => agentLabel(row),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Agent')} />
        ),
        cell: ({ row }) => (
          <div className='min-w-0'>
            <div className='truncate text-sm font-medium'>
              {agentLabel(row.original)}
            </div>
            {row.original.username && (
              <div className='text-muted-foreground truncate font-mono text-xs'>
                {row.original.username}
              </div>
            )}
          </div>
        ),
        size: 180,
      },
      {
        id: 'customer_count',
        accessorFn: (row) => row.customer_count,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Customers')} />
        ),
        cell: ({ row }) => (
          <MetricCell value={formatCount(row.original.customer_count)} />
        ),
        size: 110,
      },
      {
        id: 'paying_customer_count',
        accessorFn: (row) => row.paying_customer_count,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('Paying customers')}
          />
        ),
        cell: ({ row }) => (
          <MetricCell value={formatCount(row.original.paying_customer_count)} />
        ),
        size: 130,
      },
      {
        id: 'paying_rate',
        accessorFn: (row) =>
          computePayingRate(row.paying_customer_count, row.customer_count),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Paying rate')} />
        ),
        cell: ({ row }) => (
          <MetricCell
            value={formatRate(
              computePayingRate(
                row.original.paying_customer_count,
                row.original.customer_count
              )
            )}
          />
        ),
        size: 110,
      },
      {
        id: 'revenue',
        accessorFn: (row) => row.revenue,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('Promoted revenue')}
          />
        ),
        cell: ({ row }) => (
          <MetricCell value={formatRmb(row.original.revenue)} />
        ),
        size: 140,
      },
      {
        id: 'avg_revenue_per_customer',
        accessorFn: (row) => safeRate(row.revenue, row.customer_count),
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('Avg revenue per customer')}
          />
        ),
        cell: ({ row }) => (
          <MetricCell
            value={formatRmb(
              safeRate(row.original.revenue, row.original.customer_count)
            )}
          />
        ),
        size: 160,
      },
      {
        id: 'commission',
        accessorFn: (row) => row.commission,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Commission')} />
        ),
        cell: ({ row }) => (
          <MetricCell value={formatRmb(row.original.commission)} />
        ),
        size: 130,
      },
      {
        id: 'effective_rate',
        accessorFn: (row) => computeEffectiveRate(row.commission, row.revenue),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Effective rate')} />
        ),
        cell: ({ row }) => (
          <MetricCell
            value={formatRate(
              computeEffectiveRate(
                row.original.commission,
                row.original.revenue
              )
            )}
          />
        ),
        size: 120,
      },
      {
        id: 'first_commission_time',
        accessorFn: (row) => row.first_commission_time,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('First commission')}
          />
        ),
        meta: { mobileHidden: true },
        cell: ({ row }) => {
          const formatted = formatCommissionDate(
            row.original.first_commission_time
          )
          if (!formatted) return <MetricCell value={t('Never')} muted />
          return <MetricCell value={formatted} />
        },
        size: 140,
      },
      {
        id: 'last_commission_time',
        accessorFn: (row) => row.last_commission_time,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Last commission')} />
        ),
        cell: ({ row }) => (
          <LastCommissionCell
            timestamp={row.original.last_commission_time}
            nowSeconds={nowSeconds}
          />
        ),
        size: 190,
      },
      {
        id: 'active_30d',
        accessorFn: (row) => row.active_30d,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('30-day activity')} />
        ),
        cell: ({ row }) => {
          const commissions = row.original.active_30d
          if (commissions <= 0) return <MetricCell value={t('Idle')} muted />
          return (
            <MetricCell
              value={t('{{commissions}} commissions', { commissions })}
            />
          )
        },
        size: 150,
      },
    ],
    [nowSeconds, t]
  )
}
