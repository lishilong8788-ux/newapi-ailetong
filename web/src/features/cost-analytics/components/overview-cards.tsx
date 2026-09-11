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
  Info,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StaggerContainer, StaggerItem } from '@/components/page-transition'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'

import { buildOverviewModel } from '../lib'
import type { CostOverview } from '../types'

interface OverviewCardsProps {
  overview?: CostOverview
  loading: boolean
  error: boolean
  /** Human-readable active window, restated so a partial total is never misread. */
  windowLabel: string
}

/**
 * The unknown (unpriced) traffic share, given its own panel.
 *
 * Design doc §4.5 makes this the health indicator of the whole ledger: above 5%
 * the cost table has a hole big enough that every margin number on the page is
 * untrustworthy, and the panel has to say so rather than show the margins as
 * fact.
 */
function UnknownRatePanel(props: {
  overview: CostOverview
  loading: boolean
  error: boolean
}) {
  const { t } = useTranslation()
  const model = buildOverviewModel(props.overview)

  let value = model.unknownRate
  if (props.error) value = '--'

  return (
    <div className='flex flex-col justify-between gap-3 border-t bg-[linear-gradient(135deg,color-mix(in_oklch,var(--overview-accent-2)_12%,var(--background))_0%,color-mix(in_oklch,var(--overview-accent-1)_7%,var(--background))_100%)] p-3 sm:gap-4 sm:p-5 xl:border-t-0 xl:border-l'>
      <div className='flex flex-col gap-2 sm:gap-3'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground text-xs font-medium'>
            {t('Unpriced traffic share')}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type='button'
                  className='text-muted-foreground hover:text-foreground rounded-full'
                  aria-label={t('What is the unpriced traffic share?')}
                />
              }
            >
              <Info className='size-3.5' aria-hidden='true' />
            </TooltipTrigger>
            <TooltipContent className='max-w-72'>
              {t(
                'Requests whose upstream cost could not be resolved from any pricing tier. Above 5% the cost table has a hole big enough that every margin figure is untrustworthy — fix cost pricing before trusting this page.'
              )}
            </TooltipContent>
          </Tooltip>
        </div>

        {props.loading ? (
          <Skeleton className='h-8 w-24' />
        ) : (
          <div className='flex items-center gap-2'>
            <span className='font-mono text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl'>
              {value}
            </span>
            {model.unknownUnhealthy && (
              <TriangleAlert
                className='text-destructive size-5 shrink-0'
                aria-hidden='true'
              />
            )}
          </div>
        )}
        {model.unknownUnhealthy && (
          <p className='text-destructive text-xs'>
            {t(
              'Margin figures are unreliable while unpriced traffic is above 5%. Configure channel cost prices first.'
            )}
          </p>
        )}
      </div>

      <div className='bg-background/60 rounded-lg px-2.5 py-2'>
        <div className='text-muted-foreground flex items-center gap-1 text-[11px] leading-none font-medium'>
          <CircleDollarSign className='size-3 shrink-0' aria-hidden='true' />
          <span className='truncate'>{t('Unpriced revenue')}</span>
        </div>
        <div className='mt-1.5 truncate text-xs font-semibold tabular-nums'>
          {props.error
            ? '--'
            : props.loading
              ? ''
              : buildOverviewModel(props.overview).marginRate === ''
                ? '--'
                : t('{{share}} of {{count}} requests', {
                    share: model.unknownRate,
                    count: Intl.NumberFormat('en-US').format(
                      props.overview.request_count ?? 0
                    ),
                  })}
        </div>
      </div>
    </div>
  )
}

export function OverviewCards(props: OverviewCardsProps) {
  const { t } = useTranslation()
  const model = props.overview
    ? buildOverviewModel(props.overview)
    : {
        revenue: '-',
        cost: '-',
        margin: '-',
        marginRate: '-',
        unknownRate: '-',
        unknownUnhealthy: false,
      }

  const cards = [
    {
      key: 'revenue',
      title: t('Revenue'),
      value: model.revenue,
      description: t('Quota charged to users'),
      icon: CircleDollarSign,
      tone: 'accent-1' as const,
    },
    {
      key: 'cost',
      title: t('Upstream cost'),
      value: model.cost,
      description: t('What we pay providers'),
      icon: TrendingDown,
      tone: 'accent-2' as const,
    },
    {
      key: 'margin',
      title: t('Margin'),
      value: model.margin,
      description: model.marginRate,
      icon: TrendingUp,
      tone: 'accent-3' as const,
    },
  ]

  return (
    <section
      className='bg-card overflow-hidden rounded-2xl border shadow-xs'
      aria-label={t('Cost overview')}
    >
      <div className='grid xl:grid-cols-[minmax(0,1fr)_20rem]'>
        <div className='flex flex-col gap-2.5 p-3 sm:gap-3 sm:p-5'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='flex flex-col gap-1'>
              <h3 className='text-sm font-semibold sm:text-base'>
                {t('Cost & margin at a glance')}
              </h3>
              <p className='text-muted-foreground text-xs sm:text-sm'>
                {props.windowLabel}
              </p>
            </div>
          </div>

          <StaggerContainer className='grid grid-cols-3 gap-1.5 sm:gap-3'>
            {cards.map((card) => (
              <StaggerItem
                key={card.key}
                className='bg-background/60 rounded-lg border px-2 py-1.5 sm:rounded-xl sm:p-3'
              >
                <StatCard
                  title={card.title}
                  value={props.error ? '--' : card.value}
                  description={card.description}
                  icon={card.icon}
                  tone={card.tone}
                  loading={props.loading}
                  error={props.error}
                  compactMobile
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>

        <UnknownRatePanel
          overview={
            props.overview ?? {
              start_ts: 0,
              end_ts: 0,
              revenue_quota: 0,
              cost_quota: 0,
              margin_quota: 0,
              margin_rate: null,
              unknown_quota: 0,
              unknown_rate: null,
              request_count: 0,
            }
          }
          loading={props.loading}
          error={props.error}
        />
      </div>
    </section>
  )
}
