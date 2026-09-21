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
import { BadgeDollarSign, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatLatency } from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import {
  getChannelLabel,
  isChannelPriced,
  toChannelPricedModel,
} from '../lib/channel-price'
import { getPriceComparison } from '../lib/price-comparison'
import type { ChannelCategory, ChannelRoute, PricingModel, TokenUnit } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'
import { PriceComparisonTable } from './price-comparison-table'

/** i18n keys for the coarse supplier categories the backend classifies. */
const CATEGORY_LABEL_KEYS: Record<ChannelCategory, string> = {
  vendor: 'Model vendor',
  public_cloud: 'Public cloud',
  aggregator: 'Aggregator',
  self_hosted: 'Self-hosted',
  other: 'Other route',
}

export interface ChannelPriceCardsProps {
  model: PricingModel
  routes: ChannelRoute[]
  priceRate: number
  usdExchangeRate: number
  tokenUnit: TokenUnit
  showRechargePrice?: boolean
}

/**
 * One card per upstream line that can serve this model, cheapest first.
 *
 * A different axis from {@link GroupPriceCards}, which is one card per GROUP: a
 * group card answers "what do you pay on this tier of membership", a channel card
 * answers "what does this upstream line charge". Both are needed — the group
 * ratio and the channel discount multiply independently — and neither can be
 * derived from the other.
 *
 * Order comes from the backend, which sorts by the same resolved price the router
 * ranks on, so this list doubles as the routing preference order. Re-sorting here
 * would risk showing an order the router does not use.
 */
export function ChannelPriceCards(props: ChannelPriceCardsProps) {
  const { t } = useTranslation()

  if (props.routes.length === 0) return null

  // Badge the cheapest row only when it is actually cheapest. With every channel
  // on the same price — the state before any discount is configured — "lowest
  // price" would be an arbitrary pick dressed up as a recommendation.
  const cheapestRatio = props.routes[0]?.price.model_ratio
  const hasLowest =
    props.routes.length > 1 &&
    isChannelPriced(props.routes[0]) &&
    props.routes[1].price.model_ratio - cheapestRatio > 1e-9

  return (
    <div className='space-y-2.5'>
      {props.routes.map((route, index) => {
        const channelModel = toChannelPricedModel(props.model, route)
        const comparison = getPriceComparison(channelModel, {
          tokenUnit: props.tokenUnit,
          showRechargePrice: props.showRechargePrice,
          priceRate: props.priceRate,
          usdExchangeRate: props.usdExchangeRate,
        })
        const isLowest = hasLowest && index === 0
        const unitLabel = comparison.isPerRequest
          ? t('Channel price')
          : `${t('Channel price')}/${props.tokenUnit}`
        const officialLabel = comparison.isPerRequest
          ? t('Official price')
          : `${t('Official price')}/${props.tokenUnit}`

        return (
          <div
            key={route.channel_id}
            className={cn(
              'bg-card rounded-xl border p-2.5',
              isLowest && 'border-orange-500/40 bg-orange-500/[0.04]'
            )}
          >
            <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
              <span className='text-muted-foreground/70 shrink-0 text-[11px]'>
                {t(CATEGORY_LABEL_KEYS[route.category] ?? CATEGORY_LABEL_KEYS.other)}
              </span>
              <span className='text-muted-foreground/40 shrink-0 text-[11px]'>
                ·
              </span>
              <span className='text-foreground shrink-0 font-mono text-[13px] font-semibold'>
                {getChannelLabel(route)}
              </span>
              {isLowest && (
                <span className='inline-flex shrink-0 items-center gap-1 rounded-md bg-orange-500/12 px-2 py-0.5 text-[11px] font-semibold text-orange-600 dark:bg-orange-400/15 dark:text-orange-400'>
                  <BadgeDollarSign className='size-3' />
                  {t('Lowest price')}
                </span>
              )}
              <ModelBillingModeBadge model={props.model} />
            </div>

            <PriceComparisonTable
              comparison={comparison}
              unitLabel={unitLabel}
              officialLabel={officialLabel}
              className='mt-2'
            />

            {route.latency_ms != null && route.latency_ms > 0 && (
              <div className='mt-2 flex items-center justify-end'>
                <span
                  className='text-muted-foreground inline-flex items-center gap-1 text-xs'
                  title={t('Latency of the most recent channel test')}
                >
                  <Timer className='size-3 shrink-0' aria-hidden />
                  <span className='font-mono tabular-nums'>
                    {formatLatency(route.latency_ms)}
                  </span>
                </span>
              </div>
            )}
          </div>
        )
      })}

      {/* Stated once under the list rather than per card. The per-channel cache
          rate is the number most likely to differ from a reader's expectation,
          and which channel serves a request is decided at request time. */}
      <p className='text-muted-foreground/70 text-[11px] leading-relaxed'>
        {t(
          'Some channels price cached reads above the vendor direct rate. What you actually pay depends on the channel selected, its price tier, and your input/output/cache usage.'
        )}
      </p>
    </div>
  )
}
