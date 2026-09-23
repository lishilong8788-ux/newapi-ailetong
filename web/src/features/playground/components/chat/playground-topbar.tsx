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
import { Bug } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The pinned channel, as far as this bar needs to name it. */
export type TopbarChannel = {
  id: number
  /** Short line code (`hs4`); absent falls back to `#id`. */
  code?: string
}

export interface PlaygroundTopbarProps {
  modelName: string
  /** Pinned channel, or `undefined` for automatic routing. */
  channel?: TopbarChannel
  isStreamEnabled: boolean
  onStreamEnabledChange: (streamEnabled: boolean) => void
  isDebugEnabled: boolean
  onDebugEnabledChange: (debugEnabled: boolean) => void
  className?: string
}

/**
 * The state of the next request, in one line.
 *
 * Present at every breakpoint on purpose: the model library sidebar is
 * `hidden lg:flex`, so below `lg` this bar is the only place the active channel
 * appears at all, and "which line am I about to call" is not a desktop-only
 * question.
 *
 * Purely presentational — both toggles report outward and render what they are
 * told, so the single owner of this state stays the page holding the config.
 */
export function PlaygroundTopbar(props: PlaygroundTopbarProps) {
  const { t } = useTranslation()

  // Name only. The supplier category is a property of the channel's type, not of
  // this request, and it does not change when the reader switches lines — so in a
  // bar that reports what the next request will do, it was the one item that
  // never varied.
  const channelLabel = props.channel
    ? [props.channel.code || `#${props.channel.id}`].filter(Boolean).join(' ')
    : t('Automatic routing')

  return (
    <div
      className={cn(
        'border-border/60 flex h-11 shrink-0 items-center gap-2 border-b px-3',
        props.className
      )}
    >
      <div className='text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 text-xs'>
        <span className='text-foreground truncate font-medium'>
          {props.modelName}
        </span>
        <span aria-hidden='true'>·</span>
        <span className='truncate'>{channelLabel}</span>
        <span aria-hidden='true'>·</span>

        {/*
          The only entry point to `stream`. It defaults to on and has never had a
          control, so the non-streaming path was unreachable from the UI — and it
          is the path where first-token time does not exist, which the debug panel
          can only say if the user can get there.
        */}
        <Button
          aria-pressed={props.isStreamEnabled}
          className='h-6 px-1.5 text-xs font-normal'
          onClick={() => props.onStreamEnabledChange(!props.isStreamEnabled)}
          size='xs'
          variant='ghost'
        >
          {props.isStreamEnabled ? t('Streaming') : t('Non-streaming')}
        </Button>
      </div>

      <Button
        aria-pressed={props.isDebugEnabled}
        className={cn(
          'h-7 shrink-0 px-2 text-xs',
          props.isDebugEnabled && 'bg-muted text-foreground'
        )}
        onClick={() => props.onDebugEnabledChange(!props.isDebugEnabled)}
        size='xs'
        variant='ghost'
      >
        <Bug aria-hidden='true' className='size-3.5' />
        {t('Debug')}
      </Button>
    </div>
  )
}
