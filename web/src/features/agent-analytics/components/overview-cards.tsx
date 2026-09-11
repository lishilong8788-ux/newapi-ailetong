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
  BadgePercent,
  Coins,
  HandCoins,
  Info,
  UserCheck,
  Users,
  Wallet,
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

import { formatCount, formatRate, formatRmb } from '../lib'
import type { AgentAnalyticsOverview } from '../types'

interface OverviewCardsProps {
  overview?: AgentAnalyticsOverview
  loading: boolean
  error: boolean
  /** Human-readable active window, restated so a partial total is never misread. */
  windowLabel: string
}

const EMPTY_OVERVIEW: AgentAnalyticsOverview = {
  total_agents: 0,
  active_agents: 0,
  promoted_customers: 0,
  paying_customers: 0,
  paying_rate: 0,
  promoted_revenue: 0,
  commission_paid: 0,
  effective_rate: 0,
  pending_payout: 0,
}

/**
 * The effective commission rate, given its own panel.
 *
 * Design doc 11.2 makes this the headline number: it is the true blended cost of
 * the channel and drifts away from the nominal default rate as the mix of
 * per-agent rates shifts. Sitting it in the grid with the counts would bury it.
 */
function EffectiveRatePanel(props: {
  overview: AgentAnalyticsOverview
  loading: boolean
  error: boolean
}) {
  const { t } = useTranslation()

  let value = formatRate(props.overview.effective_rate)
  if (props.error) value = '--'

  return (
    <div className='flex flex-col justify-between gap-3 border-t bg-[linear-gradient(135deg,color-mix(in_oklch,var(--overview-accent-2)_12%,var(--background))_0%,color-mix(in_oklch,var(--overview-accent-1)_7%,var(--background))_100%)] p-3 sm:gap-4 sm:p-5 xl:border-t-0 xl:border-l'>
      <div className='flex flex-col gap-2 sm:gap-3'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground text-xs font-medium'>
            {t('Effective commission rate')}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type='button'
                  className='text-muted-foreground hover:text-foreground rounded-full'
                  aria-label={t('What is the effective commission rate?')}
                />
              }
            >
              <Info className='size-3.5' aria-hidden='true' />
            </TooltipTrigger>
            <TooltipContent className='max-w-72'>
              {t(
                'Commission paid divided by promoted revenue. This is the real cost of the channel: it drifts away from the nominal default rate as the mix of per-agent rates shifts, so a rising number means high-rate agents are taking a larger share.'
              )}
            </TooltipContent>
          </Tooltip>
        </div>

        {props.loading ? (
          <Skeleton className='h-8 w-24' />
        ) : (
          <div className='font-mono text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl'>
            {value}
          </div>
        )}

        <div className='grid grid-cols-2 gap-2'>
          <div className='bg-background/60 rounded-lg px-2.5 py-2'>
            <div className='text-muted-foreground flex items-center gap-1 text-[11px] leading-none font-medium'>
              <Coins className='size-3 shrink-0' aria-hidden='true' />
              <span className='truncate'>{t('Promoted revenue')}</span>
            </div>
            <div className='mt-1.5 truncate text-xs font-semibold tabular-nums'>
              {props.error ? '--' : formatRmb(props.overview.promoted_revenue)}
            </div>
          </div>
          <div className='bg-background/60 rounded-lg px-2.5 py-2'>
            <div className='text-muted-foreground flex items-center gap-1 text-[11px] leading-none font-medium'>
              <HandCoins className='size-3 shrink-0' aria-hidden='true' />
              <span className='truncate'>{t('Commission paid')}</span>
            </div>
            <div className='mt-1.5 truncate text-xs font-semibold tabular-nums'>
              {props.error ? '--' : formatRmb(props.overview.commission_paid)}
            </div>
          </div>
        </div>
      </div>

      <div className='bg-background/60 rounded-lg px-2.5 py-2'>
        <div className='text-muted-foreground flex items-center gap-1 text-[11px] leading-none font-medium'>
          <Wallet className='size-3 shrink-0' aria-hidden='true' />
          <span className='truncate'>{t('Pending payout')}</span>
        </div>
        <div className='mt-1.5 truncate text-xs font-semibold tabular-nums'>
          {props.error ? '--' : formatRmb(props.overview.pending_payout)}
        </div>
      </div>
    </div>
  )
}

export function OverviewCards(props: OverviewCardsProps) {
  const { t } = useTranslation()
  const overview = props.overview ?? EMPTY_OVERVIEW

  const cards = [
    {
      key: 'agents',
      title: t('Agents'),
      value: formatCount(overview.total_agents),
      description: t('{{active}} active in the last 30 days', {
        active: formatCount(overview.active_agents),
      }),
      icon: Users,
      tone: 'accent-1' as const,
    },
    {
      key: 'customers',
      title: t('Promoted customers'),
      value: formatCount(overview.promoted_customers),
      description: t('Users attributed to an agent'),
      icon: UserCheck,
      tone: 'accent-2' as const,
    },
    {
      key: 'paying',
      title: t('Paying customers'),
      value: formatCount(overview.paying_customers),
      description: t('{{rate}} of promoted customers have topped up', {
        rate: formatRate(overview.paying_rate),
      }),
      icon: BadgePercent,
      tone: 'accent-3' as const,
    },
  ]

  return (
    <section
      className='bg-card overflow-hidden rounded-2xl border shadow-xs'
      aria-label={t('Distribution overview')}
    >
      <div className='grid xl:grid-cols-[minmax(0,1fr)_20rem]'>
        <div className='flex flex-col gap-2.5 p-3 sm:gap-3 sm:p-5'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='flex flex-col gap-1'>
              <h3 className='text-sm font-semibold sm:text-base'>
                {t('Distribution at a glance')}
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
                  value={card.value}
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

        <EffectiveRatePanel
          overview={overview}
          loading={props.loading}
          error={props.error}
        />
      </div>
    </section>
  )
}
