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
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getSuccessRateDotClass,
  getSuccessRateLevel,
  type SuccessRateLevel,
} from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

/** Default number of segments in the gauge. */
export const DEFAULT_SUCCESS_RATE_BAR_COUNT = 5

export interface SuccessRateBarsProps {
  /** Aggregate success rate, 0-100. Non-finite values render as "no data". */
  rate: number
  count?: number
  className?: string
}

/**
 * How many segments to light up, given a rate that is known to be real.
 *
 * Filling proceeds left to right so the bar reads as a level, not as a
 * timeline. `floor` keeps a full bar honest — only a true 100% lights every
 * segment — while the floor of 1 keeps a measured rate visually distinct from
 * having no measurement at all: the backend only reports a group once it has
 * served requests, so 0% means "everything failed", which must not render as
 * the same empty track as "nothing to show yet".
 */
function filledSegments(rate: number, count: number): number {
  return Math.min(count, Math.max(1, Math.floor((rate / 100) * count)))
}

const LEVEL_LABEL_KEY: Record<SuccessRateLevel, string> = {
  excellent: 'Very stable, no failures recently',
  good: 'Stable, occasional failures',
  warning: 'Unstable, failures are noticeable',
  critical: 'Frequently failing, try another group',
  unknown: 'Not enough data yet',
}

/**
 * Compact stability gauge: a row of segments filled left to right in proportion
 * to the recent request success rate, with the exact number and a plain-language
 * verdict on hover, tap, or keyboard focus.
 *
 * The sampling window is a server-side setting
 * (`perf_metrics_setting.bucket_time`), so the tooltip talks about "recent"
 * requests rather than naming a span.
 */
export const SuccessRateBars = memo(function SuccessRateBars(
  props: SuccessRateBarsProps
) {
  const { t } = useTranslation()

  const count = props.count ?? DEFAULT_SUCCESS_RATE_BAR_COUNT
  const hasData = Number.isFinite(props.rate)
  const rate = hasData ? Math.min(100, Math.max(0, props.rate)) : 0
  const filled = hasData ? filledSegments(rate, count) : 0
  const level = getSuccessRateLevel(hasData ? rate : Number.NaN)
  const label = hasData
    ? `${t('Stability')} ${rate.toFixed(1)}%`
    : t('Stability unavailable')

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type='button'
            // The gauge lives inside clickable cards, so it must not look or
            // behave like a second action: no hover styling, no tab stop (the
            // card owns that, and a role="radio" card may not contain focusable
            // descendants), and the click exists only to make the tooltip
            // reachable by tap. The aria-label carries the number for AT.
            tabIndex={-1}
            className={cn(
              'inline-flex h-4 cursor-default items-center gap-0.5 outline-none',
              props.className
            )}
            aria-label={label}
          />
        }
      >
        {Array.from({ length: count }, (_, index) => (
          <span
            key={index}
            aria-hidden
            className={cn(
              'h-2.5 w-1.5 rounded-[2px]',
              index < filled
                ? getSuccessRateDotClass(rate)
                : 'bg-muted-foreground/15'
            )}
          />
        ))}
      </TooltipTrigger>
      <TooltipContent side='top' className='flex-col items-start gap-0.5'>
        <span className='font-medium'>{label}</span>
        <span className='text-background/70'>{t(LEVEL_LABEL_KEY[level])}</span>
        {hasData && (
          <span className='text-background/70'>
            {t('Share of recent requests that succeeded')}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
})
