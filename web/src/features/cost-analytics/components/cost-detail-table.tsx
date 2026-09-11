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

import {
  formatCount,
  formatQuotaAmount,
  formatRate,
  formatTokenCount,
  marginTone,
  sortByMarginRate,
} from '../lib'
import type { CostChannelRow } from '../types'

interface CostDetailTableProps {
  channels: CostChannelRow[]
  loading: boolean
}

/**
 * Plain table (no data-table machinery): this is a short, read-only, admin-only
 * list where sorting is fixed (worst margin first) and there is no pagination —
 * one aggregated row per channel.
 */
export function CostDetailTable(props: CostDetailTableProps) {
  const { t } = useTranslation()
  const rows = useMemo(
    () => sortByMarginRate(props.channels),
    [props.channels]
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
        {t('No cost data recorded yet')}
      </div>
    )
  }

  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Channel')}</TableHead>
            <TableHead className='text-right'>{t('Requests')}</TableHead>
            <TableHead className='text-right'>{t('Tokens')}</TableHead>
            <TableHead className='text-right'>{t('Revenue')}</TableHead>
            <TableHead className='text-right'>{t('Upstream cost')}</TableHead>
            <TableHead className='text-right'>{t('Margin')}</TableHead>
            <TableHead className='text-right'>{t('Margin rate')}</TableHead>
            <TableHead className='text-right'>{t('Pricing coverage')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const coverage =
              row.request_count > 0
                ? 1 - row.unknown_count / row.request_count
                : null
            const margin = row.revenue_quota - row.cost_quota
            const tone = marginTone(row.margin_rate)
            return (
              <TableRow key={row.channel_id}>
                <TableCell className='font-medium'>
                  {row.channel_name || `#${row.channel_id}`}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatCount(row.request_count)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatTokenCount(row.token_used)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatQuotaAmount(row.revenue_quota)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatQuotaAmount(row.cost_quota)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatQuotaAmount(margin)}
                </TableCell>
                <TableCell className='text-right'>
                  {tone === 'danger' ? (
                    <Badge variant='destructive'>
                      {formatRate(row.margin_rate)}
                    </Badge>
                  ) : tone === 'warning' ? (
                    <Badge variant='warning'>
                      {formatRate(row.margin_rate)}
                    </Badge>
                  ) : (
                    <span className='tabular-nums'>
                      {formatRate(row.margin_rate)}
                    </span>
                  )}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {coverage == null ? (
                    '-'
                  ) : coverage < 0.95 ? (
                    <Badge variant='warning'>
                      {formatRate(coverage, 0)}
                    </Badge>
                  ) : (
                    formatRate(coverage, 0)
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
