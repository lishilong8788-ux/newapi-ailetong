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
import { TriangleAlert } from 'lucide-react'
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

import { ROW_UNKNOWN_RATE_WARN_THRESHOLD } from '../constants'
import {
  formatCount,
  formatQuotaAmount,
  formatRate,
  groupByModel,
  isMarginPartial,
  marginTone,
} from '../lib'
import type { CostChannelModelRow } from '../types'

interface ModelChannelTableProps {
  rows: CostChannelModelRow[]
  loading: boolean
}

/**
 * Margin rate cell, shared by the model header row and its channel rows.
 *
 * Three states have to stay distinguishable, because reading one as another
 * changes what an operator does next:
 *   - null: no priced revenue, so there is no rate at all. Rendered as an em
 *     dash, never 0%, which would read as breaking even.
 *   - negative: the channel pays more than it earns. The only reason this view
 *     exists, so it gets the loudest treatment.
 *   - high unpriced share: the rate is correct but covers only part of the
 *     traffic, which is a caveat rather than a verdict.
 */
function MarginRateCell(props: {
  marginRate: number | null
  unknownRate: number | null
}) {
  const { t } = useTranslation()

  if (props.marginRate == null) {
    return (
      <span className='text-muted-foreground'>
        <span aria-hidden='true'>—</span>
        <span className='sr-only'>
          {t('No priced revenue, so there is no margin rate')}
        </span>
      </span>
    )
  }

  const tone = marginTone(props.marginRate)
  const partial = isMarginPartial(
    props.unknownRate,
    ROW_UNKNOWN_RATE_WARN_THRESHOLD
  )
  const label = formatRate(props.marginRate)

  if (tone === 'danger') {
    return <Badge variant='destructive'>{label}</Badge>
  }
  if (tone === 'warning' || partial) {
    return <Badge variant='warning'>{label}</Badge>
  }
  return <span className='tabular-nums'>{label}</span>
}

/**
 * Unpriced share cell.
 *
 * Above the threshold the figure is not just informational any more — it is the
 * reason the neighbouring margin can only be read as indicative — so it carries
 * a warning marker, and the caveat is spelled out for screen readers instead of
 * being left to the icon's colour.
 */
function UnknownShareCell(props: { unknownRate: number | null }) {
  const { t } = useTranslation()

  if (props.unknownRate == null) {
    return (
      <span className='text-muted-foreground' aria-hidden='true'>
        —
      </span>
    )
  }

  const label = formatRate(props.unknownRate, 1)
  if (!isMarginPartial(props.unknownRate, ROW_UNKNOWN_RATE_WARN_THRESHOLD)) {
    return <span className='tabular-nums'>{label}</span>
  }

  return (
    <Badge variant='warning'>
      <TriangleAlert aria-hidden='true' />
      {label}
      <span className='sr-only'>
        {t('unpriced, so the margin covers only the priced traffic')}
      </span>
    </Badge>
  )
}

/**
 * The same model across every channel serving it, grouped by model.
 *
 * Answers the sourcing question the per-channel table cannot: nine channels run
 * one model — which one buys cheapest, which one is underwater. Plain table for
 * the same reasons as the channel detail table (admin-only, fixed sort, no
 * pagination), with a subtotal row per model so a single bad channel can be told
 * apart from a model that is unprofitable everywhere.
 */
export function ModelChannelTable(props: ModelChannelTableProps) {
  const { t } = useTranslation()
  const groups = useMemo(
    () => groupByModel(props.rows, ROW_UNKNOWN_RATE_WARN_THRESHOLD),
    [props.rows]
  )

  if (props.loading) {
    return (
      <div className='text-muted-foreground px-4 py-8 text-center text-sm'>
        {t('Loading...')}
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className='text-muted-foreground px-4 py-8 text-center text-sm'>
        {t('No cost data recorded yet')}
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Channel')}</TableHead>
              <TableHead className='text-right'>{t('Requests')}</TableHead>
              <TableHead className='text-right'>{t('Revenue')}</TableHead>
              <TableHead className='text-right'>{t('Upstream cost')}</TableHead>
              <TableHead className='text-right'>{t('Margin')}</TableHead>
              <TableHead className='text-right'>{t('Margin rate')}</TableHead>
              <TableHead className='text-right'>
                {t('Unpriced share')}
              </TableHead>
            </TableRow>
          </TableHeader>
          {groups.map((group) => (
            <TableBody key={group.modelName} className='[&>tr]:h-12'>
              <TableRow className='bg-muted/40'>
                <TableCell className='font-semibold'>
                  <span className='flex items-center gap-2'>
                    <span className='truncate'>{group.modelName}</span>
                    <span className='text-muted-foreground text-xs font-normal'>
                      {t('{{count}} channels', { count: group.channelCount })}
                    </span>
                    {group.hasLoss && (
                      <Badge variant='destructive'>{t('Losing money')}</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className='text-right font-medium tabular-nums'>
                  {formatCount(group.requestCount)}
                </TableCell>
                <TableCell className='text-right font-medium tabular-nums'>
                  {formatQuotaAmount(group.revenueQuota)}
                </TableCell>
                <TableCell className='text-right font-medium tabular-nums'>
                  {formatQuotaAmount(group.costQuota)}
                </TableCell>
                <TableCell className='text-right font-medium tabular-nums'>
                  {formatQuotaAmount(group.marginQuota)}
                </TableCell>
                <TableCell className='text-right'>
                  <MarginRateCell
                    marginRate={group.marginRate}
                    unknownRate={group.unknownRate}
                  />
                </TableCell>
                <TableCell className='text-right'>
                  <UnknownShareCell unknownRate={group.unknownRate} />
                </TableCell>
              </TableRow>
              {group.rows.map((row) => (
                <TableRow key={`${group.modelName}-${row.channel_id}`}>
                  <TableCell className='pl-6'>
                    {row.channel_name || `#${row.channel_id}`}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatCount(row.request_count)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatQuotaAmount(row.revenue_quota)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatQuotaAmount(row.cost_quota)}
                  </TableCell>
                  <TableCell
                    className={
                      row.margin_quota < 0
                        ? 'text-destructive text-right font-medium tabular-nums'
                        : 'text-right tabular-nums'
                    }
                  >
                    {formatQuotaAmount(row.margin_quota)}
                  </TableCell>
                  <TableCell className='text-right'>
                    <MarginRateCell
                      marginRate={row.margin_rate}
                      unknownRate={row.unknown_rate}
                    />
                  </TableCell>
                  <TableCell className='text-right'>
                    <UnknownShareCell unknownRate={row.unknown_rate} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'A flagged row has more than {{share}} unpriced requests: its margin only covers the priced traffic. An em dash means the row has no priced revenue at all, so no rate exists — it is not a break-even.',
          { share: formatRate(ROW_UNKNOWN_RATE_WARN_THRESHOLD, 0) }
        )}
      </p>
    </div>
  )
}
