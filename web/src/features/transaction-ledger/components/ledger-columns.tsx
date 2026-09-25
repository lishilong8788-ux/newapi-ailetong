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

import { DataTableColumnHeader } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { formatTimestampToDate, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

import { ledgerRowNumber, vendorLabel } from '../lib'
import type { LedgerRow } from '../types'
import { MarginCell, ProfitCell, QuotaCell } from './ledger-money-cells'

const PLACEHOLDER = '—'

/**
 * Sorts a column that can hold null.
 *
 * Unpriced rows sort to the bottom under both directions: their cost is
 * unknown, so ranking them as if the value were 0 would put them at the top of
 * a "biggest loss" sort and bury the actual losses.
 */
function nullsLastNumeric(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

export function useLedgerColumns(): ColumnDef<LedgerRow>[] {
  const { t } = useTranslation()

  return [
    {
      // Counts down from the range total under the default newest-first sort, so
      // the top row's number is also the number of transactions in the range.
      // Purely positional — filtering renumbers it by design.
      id: 'index',
      header: () => <span className='text-xs'>{t('#')}</span>,
      cell: ({ table, row }) => {
        const { pageIndex, pageSize } = table.getState().pagination
        return (
          <span className='text-muted-foreground font-mono text-xs tabular-nums'>
            {ledgerRowNumber({
              pageIndex,
              pageSize,
              rowIndex: row.index,
              totalRows: table.getRowCount(),
              descending: table.getState().sorting[0]?.desc !== false,
            })}
          </span>
        )
      },
      enableSorting: false,
      enableHiding: false,
      size: 56,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Time')} />
      ),
      cell: ({ row }) => (
        <span className='font-mono text-xs tabular-nums'>
          {formatTimestampToDate(row.original.createdAt)}
        </span>
      ),
      enableHiding: false,
      size: 150,
    },
    {
      accessorKey: 'username',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('User')} />
      ),
      cell: ({ row }) => {
        const ledgerRow = row.original
        return (
          <div className='flex min-w-0 flex-col gap-0.5'>
            <span className='truncate text-xs font-medium'>
              {ledgerRow.username || `#${ledgerRow.userId}`}
            </span>
            {ledgerRow.tokenName ? (
              <span className='text-muted-foreground truncate font-mono text-[11px]'>
                {ledgerRow.tokenName}
              </span>
            ) : null}
          </div>
        )
      },
      size: 130,
    },
    {
      accessorKey: 'modelName',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Model')} />
      ),
      cell: ({ row }) => {
        const ledgerRow = row.original
        return (
          <div className='flex min-w-0 flex-col gap-0.5'>
            <span className='truncate font-mono text-xs'>
              {ledgerRow.modelName || PLACEHOLDER}
            </span>
            {/* Only set when it differs from the client-facing name, so its
                presence alone tells the reader a mapping happened. */}
            {ledgerRow.upstreamModelName ? (
              <span className='text-muted-foreground truncate font-mono text-[11px]'>
                → {ledgerRow.upstreamModelName}
              </span>
            ) : null}
          </div>
        )
      },
      size: 190,
    },
    {
      id: 'vendor',
      accessorFn: (row) => vendorLabel(row.channelType),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Vendor')} />
      ),
      cell: ({ row }) => {
        const label = vendorLabel(row.original.channelType)
        if (!label) {
          return (
            <span className='text-muted-foreground text-xs'>{PLACEHOLDER}</span>
          )
        }
        return (
          <StatusBadge
            label={label}
            variant='neutral'
            size='sm'
            copyable={false}
          />
        )
      },
      size: 110,
    },
    {
      accessorKey: 'channelName',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Channel')} />
      ),
      cell: ({ row }) => {
        const ledgerRow = row.original
        return (
          <div className='flex min-w-0 flex-col gap-0.5'>
            <span className='truncate text-xs'>
              {ledgerRow.channelName || `#${ledgerRow.channelId}`}
            </span>
            <span className='text-muted-foreground font-mono text-[11px]'>
              #{ledgerRow.channelId}
            </span>
          </div>
        )
      },
      size: 140,
    },
    {
      accessorKey: 'lineCode',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Route')} />
      ),
      cell: ({ row }) =>
        row.original.lineCode ? (
          <span className='font-mono text-xs'>{row.original.lineCode}</span>
        ) : (
          <span className='text-muted-foreground text-xs'>{PLACEHOLDER}</span>
        ),
      size: 110,
    },
    {
      id: 'tokens',
      accessorFn: (row) => row.promptTokens + row.completionTokens,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Tokens')}
          className='justify-end'
        />
      ),
      cell: ({ row }) => {
        const ledgerRow = row.original
        return (
          <div className='flex flex-col items-end gap-0.5 tabular-nums'>
            <span className='text-xs'>
              {formatTokens(
                ledgerRow.promptTokens + ledgerRow.completionTokens
              )}
            </span>
            <span className='text-muted-foreground font-mono text-[11px]'>
              {formatTokens(ledgerRow.promptTokens)}/
              {formatTokens(ledgerRow.completionTokens)}
            </span>
          </div>
        )
      },
      size: 100,
    },
    {
      accessorKey: 'revenueQuota',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Sell price')}
          className='justify-end'
        />
      ),
      cell: ({ row }) => <QuotaCell value={row.original.revenueQuota} />,
      size: 110,
    },
    {
      accessorKey: 'costQuota',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Upstream cost')}
          className='justify-end'
        />
      ),
      cell: ({ row }) => (
        <QuotaCell
          value={row.original.costQuota}
          unknownHint={t('Not priced')}
        />
      ),
      sortingFn: (a, b) =>
        nullsLastNumeric(a.original.costQuota, b.original.costQuota),
      size: 110,
    },
    {
      accessorKey: 'profitQuota',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Profit')}
          className='justify-end'
        />
      ),
      cell: ({ row }) => <ProfitCell row={row.original} />,
      sortingFn: (a, b) =>
        nullsLastNumeric(a.original.profitQuota, b.original.profitQuota),
      enableHiding: false,
      size: 120,
    },
    {
      accessorKey: 'marginRate',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Margin rate')}
          className='justify-end'
        />
      ),
      cell: ({ row }) => <MarginCell row={row.original} />,
      sortingFn: (a, b) =>
        nullsLastNumeric(a.original.marginRate, b.original.marginRate),
      size: 100,
    },
    {
      accessorKey: 'useTime',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Duration')}
          className='justify-end'
        />
      ),
      cell: ({ row }) => (
        <span
          className={cn(
            'block text-right font-mono text-xs tabular-nums',
            row.original.useTime === 0 && 'text-muted-foreground'
          )}
        >
          {row.original.useTime === 0
            ? PLACEHOLDER
            : `${row.original.useTime}s`}
        </span>
      ),
      size: 80,
    },
    {
      accessorKey: 'requestId',
      header: t('Request ID'),
      cell: ({ row }) =>
        row.original.requestId ? (
          <StatusBadge
            label={row.original.requestId}
            variant='neutral'
            size='sm'
            className='max-w-[140px] [&_span]:truncate'
          />
        ) : (
          <span className='text-muted-foreground text-xs'>{PLACEHOLDER}</span>
        ),
      enableSorting: false,
      size: 160,
    },
  ]
}
