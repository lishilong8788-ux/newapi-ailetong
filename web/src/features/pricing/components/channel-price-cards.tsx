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
import { BadgeDollarSign, Timer, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatLatency,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import { isChannelPriced, toChannelPricedModel } from '../lib/channel-price'
import { getPriceComparison } from '../lib/price-comparison'
import type { ChannelRoute, PricingModel, TokenUnit } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'
import { PriceComparisonTable } from './price-comparison-table'
import { SuccessRateBars } from './success-rate-bars'

/**
 * The card's measured-behaviour footer: a stability gauge with the availability
 * figure beside it, and the mean time to first token opposite.
 *
 * Availability comes from real relay traffic, so a channel nobody has called yet
 * says so in words rather than showing a flattering 100% or a bare dash. The
 * gauge is the same one the model square uses, so a reader who learned to read it
 * there does not have to learn a second language here.
 *
 * The right-hand slot prefers measured first-token time and falls back to the
 * channel test's round trip, styled down to keep the weaker claim from passing
 * for the stronger one.
 */
function ChannelHealthRow(props: { route: ChannelRoute }) {
  const { t } = useTranslation()
  const {
    availability_pct,
    ttft_ms,
    latency_ms,
    availability_source,
    ttft_source,
  } = props.route
  const hasAvailability = typeof availability_pct === 'number'
  const isGroupFigure = availability_source === 'group'

  // Real first-token time when traffic has measured it, the channel test's round
  // trip otherwise. They are different claims and are labelled differently, but
  // one of them is nearly always available, and an empty slot tells the reader
  // less than the weaker number does.
  let speedSlot: 'ttft' | 'test' | 'none' = 'none'
  let speedMs = 0
  if (ttft_ms != null && ttft_ms > 0) {
    speedSlot = 'ttft'
    speedMs = ttft_ms
  } else if (latency_ms != null && latency_ms > 0) {
    speedSlot = 'test'
    speedMs = latency_ms
  }

  return (
    <div className='border-border/40 mt-1.5 flex items-center justify-between gap-2 border-t pt-1'>
      <div className='flex min-w-0 items-center gap-1.5'>
        {/* Labelled, like the group cards above: five small bars on their own
            read as decoration, and the reader has no way to know whether a full
            row is good or bad news. */}
        <span className='text-muted-foreground/70 shrink-0 text-[11px]'>
          {t('Stability')}
        </span>
        <SuccessRateBars
          rate={hasAvailability ? availability_pct : Number.NaN}
        />
        {hasAvailability ? (
          <span
            className={cn(
              'shrink-0 font-mono text-[11px] font-semibold tabular-nums',
              getSuccessRateTextClass(availability_pct)
            )}
            title={
              isGroupFigure
                ? t('Group average; this channel has no traffic of its own yet')
                : t('Share of recent requests that succeeded')
            }
          >
            {availability_pct.toFixed(2)}%
            {/* Marked, not silently passed off as a per-channel measurement. */}
            {isGroupFigure && (
              <span className='text-muted-foreground/60 ml-0.5 font-sans font-normal'>
                *
              </span>
            )}
          </span>
        ) : (
          // Says why it is empty. A bare dash next to five grey bars reads as a
          // broken widget, and the honest reason is short enough to print.
          <span className='text-muted-foreground/60 shrink-0 text-[11px]'>
            {t('Not measured yet')}
          </span>
        )}
      </div>

      {speedSlot === 'ttft' && (
        <Tooltip>
          <TooltipTrigger
            render={
              // Not a tab stop and not hover-styled: the card owns the click,
              // and a second focusable control inside it would read as a second
              // action. The label carries the number for assistive tech.
              <button
                type='button'
                tabIndex={-1}
                className='inline-flex cursor-default items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-sky-700 tabular-nums outline-none dark:bg-sky-400/10 dark:text-sky-400'
                aria-label={`${t('Time to first token')} ${formatLatency(speedMs)}`}
              />
            }
          >
            <Zap className='size-3 shrink-0' aria-hidden />
            <span className='font-sans font-normal opacity-70'>
              {t('First token short')}
            </span>
            {formatLatency(speedMs)}
            {ttft_source === 'group' && (
              <span className='font-sans font-normal opacity-70'>*</span>
            )}
          </TooltipTrigger>
          <TooltipContent side='top' className='flex-col items-start gap-0.5'>
            <span className='font-medium'>
              {t('Average time to first token')}
            </span>
            <span className='text-background/70'>
              {ttft_source === 'group'
                ? t('Group average; this channel has no traffic of its own yet')
                : t('Measured on streaming requests only')}
            </span>
          </TooltipContent>
        </Tooltip>
      )}

      {speedSlot === 'test' && (
        // Deliberately the muted treatment, not the blue badge above: this is one
        // hand-fired probe, not a week of real requests, and it should not look
        // like the stronger number.
        <span
          className='text-muted-foreground inline-flex shrink-0 items-center gap-1 text-[11px]'
          title={t('Latency of the most recent channel test')}
        >
          <Timer className='size-3 shrink-0' aria-hidden />
          <span className='font-mono tabular-nums'>
            {formatLatency(speedMs)}
          </span>
        </span>
      )}

      {speedSlot === 'none' && (
        <span className='text-muted-foreground/50 font-mono text-[11px]'>
          —
        </span>
      )}
    </div>
  )
}

export interface ChannelPriceCardsProps {
  model: PricingModel
  routes: ChannelRoute[]
  priceRate: number
  usdExchangeRate: number
  tokenUnit: TokenUnit
  showRechargePrice?: boolean
  selectedChannelId?: number | null
  onSelectChannel?: (channelId: number) => void
  showNotice?: boolean
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

  const showNotice = props.showNotice ?? true

  return (
    <div className='space-y-2'>
      {props.routes.map((route, index) => {
        const channelModel = toChannelPricedModel(props.model, route)
        const comparison = getPriceComparison(channelModel, {
          tokenUnit: props.tokenUnit,
          showRechargePrice: props.showRechargePrice,
          priceRate: props.priceRate,
          usdExchangeRate: props.usdExchangeRate,
        })
        const isLowest = hasLowest && index === 0
        const isSelected = props.selectedChannelId === route.channel_id
        const unitLabel = comparison.isPerRequest
          ? t('Channel price')
          : `${t('Channel price')}/${props.tokenUnit}`

        // Cards stay opaque `bg-card` in every state: they sit on a tinted
        // tray, so any `bg-*/[0.0x]` here would REPLACE the card fill rather
        // than tint it and let the tray bleed through, sinking the card into
        // the page. State is carried by the border — primary ring for "you are
        // reading this one", orange edge for "cheapest line" — never by fill.
        const clickable = Boolean(props.onSelectChannel)
        let stateStyle = ''
        if (isSelected) {
          stateStyle = 'border-primary ring-primary/25 ring-2'
        } else if (isLowest) {
          stateStyle = cn(
            'border-orange-500/60',
            clickable && 'hover:border-orange-500'
          )
        }

        return (
          <div
            key={route.channel_id}
            role={props.onSelectChannel ? 'button' : undefined}
            tabIndex={props.onSelectChannel ? 0 : undefined}
            onClick={() => props.onSelectChannel?.(route.channel_id)}
            onKeyDown={(e) => {
              if (
                props.onSelectChannel &&
                (e.key === 'Enter' || e.key === ' ')
              ) {
                e.preventDefault()
                props.onSelectChannel(route.channel_id)
              }
            }}
            className={cn(
              'bg-card border-border/70 shadow-raised rounded-xl border p-2 text-left transition-all',
              props.onSelectChannel && 'cursor-pointer',
              props.onSelectChannel && !isSelected && 'hover:border-primary/50',
              stateStyle
            )}
          >
            {/* No line name here: the automatic-routing card above lists every
                participating line, in this same order, and the detail pane on the
                right names whichever one the reader picks. Repeating it on each
                card spent the widest slot in a narrow column on a string the
                reader had already read. */}
            <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
              {isLowest && (
                <span className='inline-flex shrink-0 items-center gap-1 rounded-md bg-orange-500/12 px-2 py-0.5 text-[11px] font-semibold text-orange-600 dark:bg-orange-400/15 dark:text-orange-400'>
                  <BadgeDollarSign className='size-3' />
                  {t('Lowest price')}
                </span>
              )}
              <ModelBillingModeBadge model={props.model} />
            </div>

            {/* No official price column in this column: it is the widest of the
                four and repeats the same vendor rate down every card. The
                discount stays, and the detail pane on the right prints platform
                against official for whichever channel the reader picks. */}
            <PriceComparisonTable
              comparison={comparison}
              unitLabel={unitLabel}
              bare
              dense
              hideOfficialPrice
              className='mt-1.5'
            />

            {/* Measured behaviour, not the synthetic probe: availability from
                real traffic on the left, time to first token on the right. The
                channel test's round trip stays in the detail pane — it says how
                fast one hand-fired request came back, which is a weaker claim
                than a week of requests. No API docs button here either: the pane
                on the right already carries the per-channel quickref, and the
                button did nothing the card click did not already do. */}
            <ChannelHealthRow route={route} />
          </div>
        )
      })}

      {/* Stated once under the list rather than per card. The per-channel cache
          rate is the number most likely to differ from a reader's expectation,
          and which channel serves a request is decided at request time. */}
      {showNotice && (
        <p className='text-muted-foreground/70 text-[11px] leading-relaxed'>
          {t(
            'Some channels price cached reads above the vendor direct rate. What you actually pay depends on the channel selected, its price tier, and your input/output/cache usage.'
          )}
        </p>
      )}
    </div>
  )
}
