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
import { AlertTriangle, ArrowLeft, BadgeDollarSign, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { formatLatency } from '@/features/performance-metrics/lib/format'

import {
  getChannelLabel,
  isChannelPriced,
  toChannelGroupPricedModel,
} from '../lib/channel-price'
import type { ChannelRoute, PricingModel, TokenUnit } from '../types'
import { GroupPriceCards } from './group-price-cards'
import { ModelApiQuickref } from './model-api-quickref'
import { ModelBillingModeBadge } from './model-billing-mode-badge'
import { SectionTitle } from './model-details-shared'

export function CachePricingNotice() {
  const { t } = useTranslation()

  return (
    <div className='rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200'>
      <div className='flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300'>
        <AlertTriangle className='size-3.5 shrink-0' />
        <span>{t('Cache pricing notice')}</span>
      </div>
      <p className='mt-1.5 leading-relaxed text-amber-800/90 dark:text-amber-200/80'>
        {t(
          'Some channels price cached reads above the vendor direct rate. What you actually pay depends on the channel selected, its price tier, and your input/output/cache usage.'
        )}
      </p>
    </div>
  )
}

export interface ChannelRouteDetailProps {
  model: PricingModel
  route: ChannelRoute
  priceRate: number
  usdExchangeRate: number
  tokenUnit: TokenUnit
  showRechargePrice?: boolean
  endpointMap: Record<string, { path?: string; method?: string }>
  /** Groups the viewer can reach, for the per-group prices on this route. */
  usableGroup: Record<string, string>
  /** Total channels on this model, for the API panel's failover sentence. */
  routeCount?: number
  onBackToAuto?: () => void
  onViewCodeSamples?: () => void
}

export function ChannelRouteDetail(props: ChannelRouteDetailProps) {
  const { t } = useTranslation()
  const { route } = props

  const groupPricedModel = toChannelGroupPricedModel(props.model, route)

  const channelLabel = getChannelLabel(route)
  const isPriced = isChannelPriced(route)

  return (
    <div className='space-y-4'>
      {props.onBackToAuto && (
        <div className='flex items-center justify-between'>
          <Button
            variant='ghost'
            size='xs'
            onClick={props.onBackToAuto}
            className='text-muted-foreground hover:text-foreground -ml-1 gap-1 text-xs'
          >
            <ArrowLeft className='size-3' />
            {t('Back to automatic routing')}
          </Button>
        </div>
      )}

      {/* One price block per route, not two. The channel's own rate is already
          on the card the reader clicked in the left column; repeating it here
          above the group cards put two different numbers for the same model
          side by side and read as two competing quotes. So this pane shows only
          what a request actually costs: the channel's rate scaled by each
          group's ratio. Lives here rather than beside the channel list because
          it changes every time the selected channel changes. */}
      <section className='bg-card space-y-3 rounded-xl border p-4'>
        <div className='border-border/40 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b pb-2.5'>
          {/* Name alone on the left. Everything that qualifies it is a chip on
              the right, so the eye finds the subject at the left edge and the
              badges as one block at the other, rather than reading a name with
              chips trailing off it and a second cluster further along. */}
          <span className='text-foreground font-mono text-base font-bold'>
            {channelLabel}
          </span>

          {/* `ml-auto` as well as `justify-between`: once this wraps at a narrow
              width, `justify-between` has nothing to space out on the second
              line, and the chips would fall back to the left edge under the
              name. */}
          <div className='ml-auto flex items-center gap-1.5'>
            {isPriced && (
              <span className='inline-flex items-center gap-1 rounded-md bg-orange-500/12 px-2 py-0.5 text-xs font-semibold text-orange-600 dark:bg-orange-400/15 dark:text-orange-400'>
                <BadgeDollarSign className='size-3' />
                {t('Channel specific pricing')}
              </span>
            )}
            <ModelBillingModeBadge model={props.model} />

            {/* Availability and first token are gone from this header: the group
                cards below state both per group, which is the figure that
                actually varies. The test latency stays because nothing else
                shows it — it is one hand-fired request, not the measured average
                the group card's tooltip reports. */}
            {route.latency_ms != null && route.latency_ms > 0 && (
              <span
                className='inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-xs font-medium text-emerald-600 tabular-nums dark:bg-emerald-400/10 dark:text-emerald-400'
                title={t('Latency of the most recent channel test')}
              >
                <Timer className='size-3 shrink-0' aria-hidden />
                {/* Labelled for the same reason the group card is: an unlabelled
                    duration sitting beside "first token" reads as that same
                    metric disagreeing with itself. */}
                <span className='font-sans font-normal opacity-70'>
                  {t('Test short')}
                </span>
                {formatLatency(route.latency_ms)}
              </span>
            )}
          </div>
        </div>

        <div>
          <SectionTitle className='mb-1.5 text-[11px]'>
            {t('Group Pricing')}
          </SectionTitle>
          <p className='text-muted-foreground/80 text-xs leading-relaxed'>
            {t('This channel’s price, scaled by each group’s ratio.')}
          </p>
        </div>

        <GroupPriceCards
          model={groupPricedModel}
          usableGroup={props.usableGroup}
          priceRate={props.priceRate}
          usdExchangeRate={props.usdExchangeRate}
          tokenUnit={props.tokenUnit}
          showRechargePrice={props.showRechargePrice}
        />
      </section>

      {/* No per-channel endpoint list, because there is no such thing: the
          endpoint set is computed per MODEL as a union across its channels
          (model/pricing.go), so every channel on a model offers the same
          addresses. The old subtitle here promised "configuration specific to
          this channel" above URLs identical for every row — what actually
          differs per channel is the price, which is the block above. */}
      <ModelApiQuickref
        model={props.model}
        endpointMap={props.endpointMap}
        title={t('API Documentation')}
        badgeText={channelLabel}
        subtitle={t(
          'Same three steps for every channel — this channel’s own prices are above.'
        )}
        routeCount={props.routeCount ?? 0}
        // The one thing that *is* per-channel in this panel: the model name. A
        // line with a code is named as `<model>/<code>`, which is how a reader
        // reaches the prices they just read instead of whichever line the router
        // would have chosen.
        lineCode={route.code}
        lineCodeMissing={!route.code}
        onViewCodeSamples={props.onViewCodeSamples}
      />
    </div>
  )
}
