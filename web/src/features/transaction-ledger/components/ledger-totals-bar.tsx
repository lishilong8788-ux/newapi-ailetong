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
import {
  CircleDollarSign,
  Receipt,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatLogQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { LedgerSummary } from '../types'

/** PLACEHOLDER for a figure the range cannot produce (no priced revenue yet). */
const PLACEHOLDER = '—'

function StatTile(props: {
  label: string
  value: string
  hint: string
  icon: LucideIcon
  tone: IconBadgeTone
  loading: boolean
  valueClassName?: string
}) {
  const Icon = props.icon

  return (
    <div className='bg-background/70 flex min-w-0 flex-col gap-2 rounded-xl border p-3 sm:gap-3 sm:p-4'>
      <div className='text-muted-foreground flex items-center gap-2 text-xs font-medium'>
        <IconBadge tone={props.tone} size='sm'>
          <Icon />
        </IconBadge>
        <span className='truncate'>{props.label}</span>
      </div>
      {props.loading ? (
        <Skeleton className='h-7 w-24' />
      ) : (
        <div
          className={cn(
            'font-mono text-xl leading-none font-semibold tracking-tight break-all tabular-nums sm:text-2xl',
            props.valueClassName
          )}
        >
          {props.value}
        </div>
      )}
      {/* Always rendered, so a hint appearing on refetch cannot shift the row. */}
      <div className='text-muted-foreground/70 min-h-4 truncate text-[11px]'>
        {props.loading ? '' : props.hint}
      </div>
    </div>
  )
}

/**
 * Totals for the whole filtered range, as summed by the database.
 *
 * Not the visible page: a page total presented next to a range filter is the
 * standard way this kind of report gets misread. Cost and margin cover priced
 * rows only, and the unpriced share is shown alongside so the reader can see how
 * much of the range those totals actually account for.
 */
export function LedgerTotalsBar(props: {
  summary: LedgerSummary | undefined
  isLoading: boolean
  /** Active window, restated so a partial total is never read as all-time. */
  windowLabel: string
}) {
  const { t } = useTranslation()
  const summary = props.summary
  const unpricedCount = summary
    ? summary.request_count - summary.priced_count
    : 0
  const profitQuota = summary?.margin_quota ?? 0
  const marginRate = summary?.margin_rate ?? null
  const unpricedRate = summary?.unpriced_rate ?? null
  // An empty range is a real answer, not a missing one: 0 transactions with no
  // priced rows still deserves the panel rather than a one-line placeholder.
  const loading = props.isLoading && !summary

  const tiles = [
    {
      key: 'transactions',
      label: t('Transactions'),
      value: summary
        ? Intl.NumberFormat('en-US').format(summary.request_count)
        : '0',
      hint:
        unpricedCount > 0
          ? t('{{count}} without cost', { count: unpricedCount })
          : t('All priced'),
      icon: Receipt,
      tone: 'chart-1' as IconBadgeTone,
    },
    {
      key: 'revenue',
      label: t('Sell price'),
      value: formatLogQuota(summary?.revenue_quota ?? 0),
      hint: t('Quota charged to users'),
      icon: CircleDollarSign,
      tone: 'chart-2' as IconBadgeTone,
    },
    {
      key: 'cost',
      label: t('Upstream cost'),
      value: formatLogQuota(summary?.cost_quota ?? 0),
      hint:
        summary && summary.priced_count !== summary.request_count
          ? t('priced rows only')
          : t('What we pay providers'),
      icon: TrendingDown,
      tone: 'chart-4' as IconBadgeTone,
    },
    {
      key: 'profit',
      label: t('Profit'),
      value: `${profitQuota > 0 ? '+' : ''}${formatLogQuota(profitQuota)}`,
      hint: t('Sell price minus upstream cost'),
      icon: TrendingUp,
      tone: 'chart-3' as IconBadgeTone,
      valueClassName: cn(
        profitQuota > 0 && 'text-success',
        profitQuota < 0 && 'text-destructive'
      ),
    },
  ]

  return (
    <section
      className='bg-card overflow-hidden rounded-2xl border shadow-xs'
      aria-label={t('Ledger totals')}
    >
      <div className='grid xl:grid-cols-[minmax(0,1fr)_18rem]'>
        <div className='flex flex-col gap-3 p-3 sm:gap-4 sm:p-5'>
          <div className='flex flex-col gap-1'>
            <h3 className='text-sm font-semibold sm:text-base'>
              {t('Transactions in this range')}
            </h3>
            <p className='text-muted-foreground text-xs sm:text-sm'>
              {props.windowLabel}
            </p>
          </div>
          <div className='grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4'>
            {tiles.map((tile) => (
              <StatTile
                key={tile.key}
                label={tile.label}
                value={tile.value}
                hint={tile.hint}
                icon={tile.icon}
                tone={tile.tone}
                loading={loading}
                valueClassName={tile.valueClassName}
              />
            ))}
          </div>
        </div>

        <div className='flex flex-col justify-between gap-3 border-t bg-[linear-gradient(135deg,color-mix(in_oklch,var(--overview-accent-2)_12%,var(--background))_0%,color-mix(in_oklch,var(--overview-accent-1)_7%,var(--background))_100%)] p-3 sm:gap-4 sm:p-5 xl:border-t-0 xl:border-l'>
          <div className='flex flex-col gap-2 sm:gap-3'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Margin rate')}
            </span>
            {loading ? (
              <Skeleton className='h-9 w-24' />
            ) : (
              <span
                className={cn(
                  'font-mono text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl',
                  marginRate != null && marginRate < 0 && 'text-destructive'
                )}
              >
                {marginRate == null
                  ? PLACEHOLDER
                  : `${(marginRate * 100).toFixed(1)}%`}
              </span>
            )}
            <p className='text-muted-foreground/70 text-[11px] sm:text-xs'>
              {t('Based on priced transactions only')}
            </p>
          </div>

          <div className='bg-background/60 rounded-lg px-2.5 py-2'>
            <div className='text-muted-foreground text-[11px] leading-none font-medium'>
              {t('Pricing coverage')}
            </div>
            <div className='mt-1.5 truncate text-sm font-semibold tabular-nums'>
              {loading || unpricedRate == null
                ? PLACEHOLDER
                : `${((1 - unpricedRate) * 100).toFixed(0)}%`}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
