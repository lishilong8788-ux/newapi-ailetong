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
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import type { AutoRouteInfo, ChannelRoute } from '@/features/pricing/types'
import { cn } from '@/lib/utils'

import {
  readChannelBlockCollapsed,
  writeChannelBlockCollapsed,
} from '../../lib/channel/collapse-storage'
import { AutoRouteRow } from './auto-route-row'
import { ChannelRouteRow } from './channel-route-row'

export type ChannelPickerProps = {
  /** The model these routes serve; named in the header so the list has a subject. */
  modelName: string
  routes: ChannelRoute[]
  autoRoute?: AutoRouteInfo
  isLoading: boolean
  /** Pinned channel id; `undefined` means automatic routing. */
  channelId?: number
  /**
   * Whether this viewer may pin. Pinning is gated on `model.IsAdmin`
   * server-side, so a non-admin gets the figures without the controls rather than
   * buttons that answer with a 403.
   */
  canPin: boolean
  /**
   * Absent when the host has not wired routing. Treated exactly like a viewer who
   * may not pin: read-only rows, because a control that cannot change anything
   * must not look like it can.
   */
  onChannelChange?: (channelId: number | undefined) => void
}

/**
 * The supply side of the model the playground is pointed at: every line that can
 * serve it, and which one the next request will use.
 *
 * Sits under the model list rather than inside it because it answers a different
 * question — the list is "what am I talking to", this is "over which line" — and
 * because it has to stay put while the list above it scrolls.
 *
 * The height budget is the binding constraint on every decision here. The sidebar
 * is 288px wide and ~800px tall on a 1080p screen, of which the library header
 * already takes ~150px. An aggregator's model can have a dozen channels, so this
 * block is capped at 40% of the column and scrolls internally, and the header
 * folds it away entirely for someone who would rather have the models back.
 */
export function ChannelPicker(props: ChannelPickerProps) {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(readChannelBlockCollapsed)

  const toggle = () => {
    const next = !isCollapsed
    setIsCollapsed(next)
    writeChannelBlockCollapsed(next)
  }

  return (
    <section
      className={cn(
        'border-border/60 bg-canvas flex shrink-0 flex-col border-t',
        // A cap, not a height: two channels take the room two channels need. The
        // percentage resolves against the sidebar's own height, which the flex
        // column above provides.
        !isCollapsed && 'max-h-[40%]'
      )}
    >
      <h2 className='shrink-0'>
        <button
          type='button'
          onClick={toggle}
          aria-expanded={!isCollapsed}
          className={cn(
            'hover:bg-accent/40 flex w-full items-center gap-1.5 px-3 py-2 text-left',
            'focus-visible:ring-ring/50 outline-none focus-visible:ring-2'
          )}
        >
          <span className='text-foreground shrink-0 text-[13px] font-bold tracking-tight'>
            {t('Channels')}
          </span>
          <span className='text-muted-foreground/40 shrink-0'>·</span>
          {/* The model name, because this list is only about one of them and the
              selected card can easily be scrolled out of sight above. */}
          <span
            className='text-muted-foreground/80 min-w-0 flex-1 truncate font-mono text-[11px]'
            title={props.modelName}
          >
            {props.modelName}
          </span>
          <span
            className='text-muted-foreground/70 shrink-0 text-[11px] font-medium tabular-nums'
            aria-hidden='true'
          >
            {props.routes.length}
          </span>
          {/* The bare count above is ambiguous read aloud, so the same fact is
              spelled out for assistive tech instead of being announced as a
              stray digit. */}
          <span className='sr-only'>
            {t('{{count}} channels', { count: props.routes.length })}
          </span>
          <ChevronDown
            aria-hidden='true'
            className={cn(
              'text-muted-foreground/60 size-3.5 shrink-0 transition-transform duration-200',
              'motion-reduce:transition-none',
              isCollapsed && '-rotate-90'
            )}
          />
          <span className='sr-only'>
            {isCollapsed ? t('Expand') : t('Collapse')}
          </span>
        </button>
      </h2>

      {!isCollapsed && (
        <div className='hover-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5'>
          <ChannelPickerBody {...props} />
        </div>
      )}
    </section>
  )
}

function ChannelPickerBody(props: ChannelPickerProps) {
  const { t } = useTranslation()

  if (props.isLoading) {
    return (
      <div className='space-y-1.5'>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className='h-11 w-full rounded-lg' />
        ))}
      </div>
    )
  }

  if (props.routes.length === 0) {
    return (
      <p className='text-muted-foreground/70 px-1 py-3 text-center text-[11px]'>
        {t('No channels available')}
      </p>
    )
  }

  const pin = props.canPin ? props.onChannelChange : undefined

  return (
    <div className='space-y-1.5'>
      {/* Automatic routing is first and always present: it is the default, the
          only option a non-admin has, and the state a pinned request falls back
          to when the pin is cleared. */}
      <AutoRouteRow
        autoRoute={props.autoRoute}
        isSelected={props.channelId == null}
        onSelect={pin && (() => pin(undefined))}
      />

      {!pin && (
        // Stated once, under the row it justifies, rather than as a badge on
        // every disabled line. Without it the rows below read as a picker that
        // has stopped working.
        <p className='text-muted-foreground/60 px-1 text-[10.5px] leading-snug'>
          {t('Pinning a channel is available to administrators only.')}
        </p>
      )}

      <div className='bg-border/60 mx-1 h-px' aria-hidden='true' />

      {/* Backend order, which is the same resolved price the router ranks on.
          Re-sorting here would show an order the router does not use. */}
      {props.routes.map((route) => (
        <ChannelRouteRow
          key={route.channel_id}
          route={route}
          isSelected={props.channelId === route.channel_id}
          onSelect={pin && (() => pin(route.channel_id))}
        />
      ))}
    </div>
  )
}
