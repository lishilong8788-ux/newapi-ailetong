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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { formatRate } from '../lib'
import type { CostInventoryRow } from '../types'

interface InventoryTableProps {
  rows: CostInventoryRow[]
  loading: boolean
}

/**
 * Inventory reconciliation: the upstream-fetched balance against the
 * purchase-derived balance (purchases − accumulated cost).
 *
 * A large divergence is the ledger's self-check: it means either a cost price
 * is misconfigured or a purchase was never recorded. Both sides are shown so
 * the operator can see which one moved.
 */
export function InventoryTable(props: InventoryTableProps) {
  const { t } = useTranslation()
  const rows = useMemo(
    () =>
      [...props.rows].sort((a, b) => {
        const da = a.diff_rate ?? Number.NEGATIVE_INFINITY
        const db = b.diff_rate ?? Number.NEGATIVE_INFINITY
        return Math.abs(db) - Math.abs(da)
      }),
    [props.rows]
  )

  if (props.loading) {
    return (
      <div className='text-muted-foreground px-4 py-8 text-center text-sm'>
        {t('Loading...')}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className='text-muted-foreground px-4 py-8 text-center text-sm'>
        {t('No purchase or consumption recorded yet')}
      </div>
    )
  }

  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Channel')}</TableHead>
            <TableHead className='text-right'>{t('Fetched balance')}</TableHead>
            <TableHead className='text-right'>{t('Purchased')}</TableHead>
            <TableHead className='text-right'>{t('Spent')}</TableHead>
            <TableHead className='text-right'>{t('Derived balance')}</TableHead>
            <TableHead className='text-right'>{t('Difference')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.channel_id}>
              <TableCell className='font-medium'>
                {row.channel_name || `#${row.channel_id}`}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {row.has_fetched
                  ? `$${row.fetched_balance.toFixed(2)}`
                  : t('Not supported')}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {`$${row.purchased_usd.toFixed(2)}`}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {`$${row.spent_usd.toFixed(2)}`}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {`$${row.derived_balance.toFixed(2)}`}
              </TableCell>
              <TableCell className='text-right'>
                {row.diff_rate == null ? (
                  '-'
                ) : Math.abs(row.diff_rate) > 0.1 ? (
                  <Badge variant='destructive'>
                    {formatRate(row.diff_rate, 1)}
                  </Badge>
                ) : Math.abs(row.diff_rate) > 0.05 ? (
                  <Badge variant='warning'>
                    {formatRate(row.diff_rate, 1)}
                  </Badge>
                ) : (
                  <span className='tabular-nums'>
                    {formatRate(row.diff_rate, 1)}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
