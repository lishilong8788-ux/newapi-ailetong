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
import { Check, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AutoRouteInfo } from '@/features/pricing/types'
import { cn } from '@/lib/utils'

import { SELECTION_MARKER_CLASS, rowStateClass } from './channel-row-shared'

export type AutoRouteRowProps = {
  autoRoute?: AutoRouteInfo
  isSelected: boolean
  /** Absent for a non-admin viewer, who has no other option to switch away to. */
  onSelect?: () => void
}

/**
 * The default route, at the head of the list.
 *
 * Its subtitle is conditional because three genuinely different policies are in
 * play and promising the first one in all three is a claim the reader can be
 * billed by: price-first routing only happens when the switch is on *and* the
 * model has a price spread to rank on (`enabled && !ranked` is the normal state
 * until per-channel discounts exist). Otherwise the operator's channel order
 * decides, and failover is all this row can honestly promise.
 */
export function AutoRouteRow(props: AutoRouteRowProps) {
  const { t } = useTranslation()

  const isClickable = props.onSelect != null
  const pricePreferred = Boolean(
    props.autoRoute?.enabled && props.autoRoute.ranked
  )

  return (
    // A div with `role="button"`, matching the channel rows below it so the two
    // behave identically under keyboard and assistive tech.
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-pressed={isClickable ? props.isSelected : undefined}
      onClick={props.onSelect}
      onKeyDown={
        isClickable
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              props.onSelect?.()
            }
          : undefined
      }
      className={cn(
        'relative rounded-lg border px-2 py-1.5',
        'transition-[border-color,background-color] duration-[180ms]',
        'ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        rowStateClass(props.isSelected, isClickable)
      )}
    >
      <span
        aria-hidden='true'
        className={cn(
          SELECTION_MARKER_CLASS,
          props.isSelected && 'scale-y-100'
        )}
      />

      <div className='flex items-center gap-1.5'>
        <Zap className='text-primary size-3.5 shrink-0' aria-hidden='true' />
        <span className='text-foreground min-w-0 flex-1 truncate text-[12.5px] font-semibold'>
          {t('Automatic routing')}
        </span>
        {pricePreferred && (
          <span className='shrink-0 rounded bg-orange-500/12 px-1 text-[10.5px] font-semibold text-orange-600 dark:bg-orange-400/15 dark:text-orange-400'>
            {t('Lowest price')}
          </span>
        )}
        {/* A tick as well as the bar and the tint: this row is the default, and
            "nothing is pinned" needs to read as a positive state rather than as
            the absence of one. */}
        {props.isSelected && (
          <Check
            className='text-primary size-3.5 shrink-0'
            aria-hidden='true'
          />
        )}
      </div>

      <p className='text-muted-foreground/70 mt-0.5 text-[10.5px] leading-snug'>
        {pricePreferred
          ? t('Cheapest first · switches on failure')
          : t('Operator order · switches on failure')}
      </p>
    </div>
  )
}
