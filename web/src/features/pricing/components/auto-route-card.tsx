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
import { Route } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatDiscount } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getChannelLabel, getDiscountRange } from '../lib/channel-price'
import type { AutoRouteInfo, ChannelRoute } from '../types'

export interface AutoRouteCardProps {
  routes: ChannelRoute[]
  autoRoute?: AutoRouteInfo
  selected?: boolean
  onSelect?: () => void
}

/**
 * The header of the channel list: which lines participate in routing, and what
 * the routing policy actually is right now.
 *
 * The copy is conditional on purpose. Three states are genuinely different and
 * promising the first one in all three would be a lie the reader can be billed
 * by:
 *
 *   - switch on, prices distinguishable: requests prefer the cheapest line and
 *     fail over to the next on error.
 *   - switch on, no price spread: nothing to prefer, so the operator's channel
 *     order decides. Common — it is the state until per-channel discounts are
 *     configured.
 *   - switch off: the operator's channel order decides, full stop.
 */
export function AutoRouteCard(props: AutoRouteCardProps) {
  const { t } = useTranslation()

  if (props.routes.length === 0) return null

  const range = getDiscountRange(props.routes)
  const pricePreferred = Boolean(props.autoRoute?.enabled && props.autoRoute.ranked)

  return (
    <div
      role={props.onSelect ? 'button' : undefined}
      tabIndex={props.onSelect ? 0 : undefined}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (props.onSelect && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          props.onSelect()
        }
      }}
      className={cn(
        // Dashed base = a virtual route, not a billable line — the solid cards
        // below are the real channels. Selecting it adds the primary ring, same
        // as a selected channel card; the fill stays opaque `bg-card` so the
        // tinted tray behind never bleeds through.
        'bg-card shadow-raised rounded-xl border border-dashed p-2 transition-all',
        props.onSelect && 'cursor-pointer',
        !props.selected && props.onSelect && 'hover:border-primary/50',
        props.selected && 'border-primary ring-primary/25 ring-2'
      )}
    >
      <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
        <span className='text-foreground inline-flex items-center gap-1.5 text-[13px] font-semibold'>
          <Route className='size-3.5' aria-hidden />
          {t('Auto smart routing')}
        </span>
        {range && (
          <span className='inline-flex items-center rounded-md bg-orange-500/12 px-2 py-0.5 font-mono text-[13px] font-semibold text-orange-600 tabular-nums dark:bg-orange-400/15 dark:text-orange-400'>
            {range.min === range.max
              ? formatDiscount(range.min, t)
              : `${formatDiscount(range.min, t)} – ${formatDiscount(range.max, t)}`}
          </span>
        )}
        {/* How many lines this virtual route covers. It sits here rather than on
            the cards below because it is a fact about the routing pool, not
            about any one line. */}
        <span className='text-muted-foreground/70 ml-auto shrink-0 font-mono text-[11px] tabular-nums'>
          {props.routes.length} {t('channels')}
        </span>
      </div>

      <p className='text-muted-foreground mt-1 text-xs leading-snug'>
        {pricePreferred
          ? t(
              'Available channels join routing automatically. Requests prefer the lowest-priced channel and switch to the next one when a request fails.'
            )
          : t(
              'Available channels join routing automatically, in the order the operator configured, switching to the next one when a request fails.'
            )}
      </p>

      {/* The only place the line names are printed. The cards below repeat one
          card per line in this same order, so naming each of them again said the
          same thing a second time in a column where the prices are what the
          reader came for. */}
      <div className='mt-1.5 flex flex-wrap items-center gap-1'>
        {props.routes.map((route) => (
          <span
            key={route.channel_id}
            className='bg-muted/60 text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[11px]'
          >
            {getChannelLabel(route)}
          </span>
        ))}
      </div>
    </div>
  )
}
