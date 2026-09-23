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
import { Users, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  formatLatency,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import { SuccessRateBars } from '@/features/pricing/components/success-rate-bars'
import { getChannelLabel } from '@/features/pricing/lib'
import type { ChannelRoute } from '@/features/pricing/types'
import { cn } from '@/lib/utils'

import { SELECTION_MARKER_CLASS, rowStateClass } from './channel-row-shared'

export type ChannelRouteRowProps = {
  route: ChannelRoute
  isSelected: boolean
  /**
   * Absent for a non-admin viewer. Pinning is gated on `model.IsAdmin`
   * server-side, so the row renders as plain text for everyone else instead of a
   * button that answers a click with a 403.
   */
  onSelect?: () => void
}

/**
 * One upstream line, as two lines of text in a 288px column.
 *
 * Line one names the line, line two is measured behaviour. Nothing else: no
 * price, because the rate for the model is already under the composer and on the
 * pricing page, and a per-channel figure here would be quoted at group ratio 1
 * beside a composer quote that includes the group multiplier — two numbers for
 * one model, a step apart. No supplier category either, because it is a property
 * of the channel's *type* that never varies between the rows of one model, so it
 * repeated down the list without telling the reader which line to pick.
 */
export function ChannelRouteRow(props: ChannelRouteRowProps) {
  const { t } = useTranslation()
  const { route } = props

  const isClickable = props.onSelect != null

  return (
    // Not a `<button>`: the stability gauge inside is itself a tooltip trigger,
    // and a button may not contain another focusable control. `role="button"`
    // with an explicit key handler is the same pattern the pricing channel cards
    // use for the same reason.
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
      {/* The same left-edge bar the model cards use, for the same reason: colour
          alone gives the eye nothing to latch onto, and the sidebar is read in a
          hurry. */}
      <span
        aria-hidden='true'
        className={cn(
          SELECTION_MARKER_CLASS,
          props.isSelected && 'scale-y-100'
        )}
      />

      {/* `block` with `truncate`, not a flex row: the name is the only thing on
          this line now, and a long one must cut off at the column edge rather
          than widen the 288px sidebar. */}
      <span className='text-foreground block truncate font-mono text-[12.5px] font-semibold'>
        {getChannelLabel(route)}
      </span>

      <div className='mt-1 flex items-center gap-1.5'>
        <AvailabilityCell route={route} />

        <span
          className='text-muted-foreground/80 ml-auto inline-flex shrink-0 items-center gap-0.5 font-mono text-[11px] tabular-nums'
          title={
            route.ttft_source === 'group'
              ? t('Group average; this channel has no traffic of its own yet')
              : t('Measured on streaming requests only')
          }
        >
          <Zap className='size-3 shrink-0' aria-hidden='true' />
          <span className='sr-only'>{t('Time to first token')}</span>
          {/* `formatLatency` prints an em dash for absent and for 0, which is
              the honest reading of both: a channel that has only served
              non-streaming requests has no observable first token. */}
          <span>{formatLatency(route.ttft_ms ?? Number.NaN)}</span>
          {route.ttft_ms != null && route.ttft_ms > 0 && (
            <BorrowedMark source={route.ttft_source} />
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * The stability gauge with its figure, or a written reason for having none.
 *
 * `undefined` and `0` are different claims and must not collapse into one
 * rendering: nothing measured versus every request failing. The gauge answers
 * NaN with an empty track, the figure answers absence with words — a bare dash
 * beside five grey bars reads as a broken widget rather than as "no traffic yet".
 */
function AvailabilityCell(props: { route: ChannelRoute }) {
  const { t } = useTranslation()
  const rate = props.route.availability_pct
  const hasRate = typeof rate === 'number'

  return (
    <span className='flex min-w-0 items-center gap-1'>
      <SuccessRateBars rate={hasRate ? rate : Number.NaN} count={4} />
      {hasRate ? (
        <span
          className={cn(
            'shrink-0 font-mono text-[11px] font-semibold tabular-nums',
            getSuccessRateTextClass(rate)
          )}
          title={
            props.route.availability_source === 'group'
              ? t('Group average; this channel has no traffic of its own yet')
              : t('Share of recent requests that succeeded')
          }
        >
          {rate.toFixed(1)}%
        </span>
      ) : (
        <span className='text-muted-foreground/60 truncate text-[11px]'>
          {t('Not measured yet')}
        </span>
      )}
      {hasRate && <BorrowedMark source={props.route.availability_source} />}
    </span>
  )
}

/**
 * Marks a figure that is not this channel's own.
 *
 * A borrowed number is the model+group aggregate every line in that group
 * shares, handed to a channel that has served no traffic itself. Printing it bare
 * hands one line another's results, so it is marked wherever it appears — and
 * availability and first-token time are marked independently, because a channel
 * serving only non-streaming requests has a measured availability and a borrowed
 * first token at the same time.
 *
 * An icon rather than a letter or an asterisk: the two characters this needs in
 * CJK ("借") and in English ("grp") have nothing in common, and at 11px an
 * asterisk beside a percentage reads as a footnote nobody can find.
 */
function BorrowedMark(props: { source?: 'channel' | 'group' }) {
  const { t } = useTranslation()

  if (props.source !== 'group') return null

  return (
    <Users
      className='text-muted-foreground/70 size-3 shrink-0'
      aria-label={t(
        'Group average; this channel has no traffic of its own yet'
      )}
      role='img'
    />
  )
}
