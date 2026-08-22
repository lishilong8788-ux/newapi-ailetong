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
import { useQuery } from '@tanstack/react-query'
import { Check, Sparkles, Timer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getPerfMetrics } from '@/features/performance-metrics/api'
import { formatLatency } from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import { getAvailableGroups, getDisplayGroupRatio } from '../lib/model-helpers'
import { getPriceComparison } from '../lib/price-comparison'
import type { PricingModel, TokenUnit } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'
import { PriceComparisonTable } from './price-comparison-table'
import { SuccessRateBars } from './success-rate-bars'

export interface GroupPriceCardsProps {
  model: PricingModel
  usableGroup: Record<string, string>
  priceRate: number
  usdExchangeRate: number
  tokenUnit: TokenUnit
  showRechargePrice?: boolean
}

/**
 * One card per group the viewer can actually reach, each showing that group's
 * own price comparison and recent health.
 *
 * This replaces the wide group table on narrow surfaces: a drawer column cannot
 * fit "group + ratio + input + output + cache + health" as columns, but the same
 * data reads fine stacked.
 */
export function GroupPriceCards(props: GroupPriceCardsProps) {
  const { t } = useTranslation()

  // Cheapest first, so the card a buyer wants is the one they land on. The
  // leader is only badged when it actually beats the runner-up: on a model where
  // every reachable group bills at the same ratio, "best value" would be an
  // arbitrary pick dressed up as a recommendation.
  const availableGroups = useMemo(() => {
    const groups = getAvailableGroups(props.model, props.usableGroup || {})
    return groups
      .map((group) => ({
        group,
        ratio: getDisplayGroupRatio(props.model, group),
      }))
      .sort((a, b) => a.ratio - b.ratio)
  }, [props.model, props.usableGroup])

  const hasBestValue =
    availableGroups.length > 1 &&
    availableGroups[0].ratio < availableGroups[1].ratio

  // Selection is local to this list: it exists so a reader comparing two groups
  // can park on one and keep their place, not to change what anything else on
  // the page is priced at. Defaults to the cheapest, which is the row already
  // wearing the "best value" badge.
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  useEffect(() => {
    setSelectedGroup(availableGroups[0]?.group ?? null)
  }, [availableGroups])

  // Shares the query key with the Performance tab so react-query serves both
  // from a single request.
  const metricsQuery = useQuery({
    queryKey: ['perf-metrics', props.model.model_name],
    queryFn: () => getPerfMetrics(props.model.model_name, 24),
    staleTime: 60 * 1000,
    retry: false,
  })

  const healthByGroup = useMemo(() => {
    const map = new Map<string, { successRate: number; latencyMs: number }>()
    for (const group of metricsQuery.data?.data.groups ?? []) {
      map.set(group.group, {
        successRate: group.success_rate,
        latencyMs: group.avg_latency_ms,
      })
    }
    return map
  }, [metricsQuery.data])

  if (availableGroups.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>
        {t(
          'This model is not available in any group, or no group pricing information is configured.'
        )}
      </p>
    )
  }

  return (
    <div role='radiogroup' aria-label={t('Groups')} className='space-y-2.5'>
      {availableGroups.map((entry, index) => {
        const group = entry.group
        const isBestValue = hasBestValue && index === 0
        const comparison = getPriceComparison(props.model, {
          tokenUnit: props.tokenUnit,
          showRechargePrice: props.showRechargePrice,
          priceRate: props.priceRate,
          usdExchangeRate: props.usdExchangeRate,
          selectedGroup: group,
        })
        const isSelected = selectedGroup === group
        const health = healthByGroup.get(group)
        const unitLabel = comparison.isPerRequest
          ? t('Platform price')
          : `${t('Platform price')}/${props.tokenUnit}`

        return (
          <div
            key={group}
            role='radio'
            tabIndex={0}
            aria-checked={isSelected}
            onClick={() => setSelectedGroup(group)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              setSelectedGroup(group)
            }}
            className={cn(
              'bg-card cursor-pointer rounded-xl border p-2.5 outline-none',
              // Only the properties that actually move: the price table inside
              // has colour transitions of its own, and animating everything
              // made them lag a beat behind the card's own border.
              'transition-[border-color,box-shadow,background-color] duration-200 ease-out',
              'hover:border-primary/40',
              'focus-visible:ring-primary/50 focus-visible:ring-2',
              isBestValue && 'border-orange-500/40 bg-orange-500/[0.04]',
              // Selection outranks the best-value tint: the reader put it there,
              // so it wins the border. A ring rather than a thicker border, so
              // nothing below it shifts by a pixel when selection moves.
              isSelected &&
                'border-primary ring-primary/25 hover:border-primary ring-2'
            )}
          >
            <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
              {isBestValue && (
                <span className='inline-flex shrink-0 items-center gap-1 rounded-md bg-orange-500/12 px-2 py-0.5 text-[11px] font-semibold text-orange-600 dark:bg-orange-400/15 dark:text-orange-400'>
                  <Sparkles className='size-3' />
                  {t('Best value')}
                </span>
              )}
              <GroupBadge
                group={group}
                desc={props.usableGroup[group]}
                ratio={comparison.hasDiscount ? comparison.ratio : null}
                ratioDisplay='discount'
                size='sm'
              />
              <ModelBillingModeBadge model={props.model} />
              {isSelected && (
                <span className='bg-primary text-primary-foreground ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-full'>
                  <Check className='size-3' />
                </span>
              )}
            </div>

            <PriceComparisonTable
              comparison={comparison}
              unitLabel={unitLabel}
              className='mt-2'
            />

            {health && (
              <div className='mt-2 flex items-center justify-between gap-2'>
                <div className='flex min-w-0 items-center gap-1.5'>
                  <span className='text-muted-foreground/70 shrink-0 text-[11px]'>
                    {t('Stability')}
                  </span>
                  <SuccessRateBars rate={health.successRate} />
                </div>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type='button'
                        // Not a tab stop: the card itself is the radio, and
                        // ARIA forbids focusable descendants inside one. The
                        // aria-label still spells the number out for AT.
                        tabIndex={-1}
                        aria-label={`${t('Average latency')} ${formatLatency(health.latencyMs)}`}
                        className='text-muted-foreground inline-flex shrink-0 cursor-default items-center gap-1 text-xs outline-none'
                      />
                    }
                  >
                    <Timer className='size-3 shrink-0' aria-hidden />
                    <span className='font-mono tabular-nums'>
                      {formatLatency(health.latencyMs)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side='top'
                    className='flex-col items-start gap-0.5'
                  >
                    <span className='font-medium'>{t('Average latency')}</span>
                    <span className='text-background/70'>
                      {t('Average end-to-end time of recent requests')}
                    </span>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
