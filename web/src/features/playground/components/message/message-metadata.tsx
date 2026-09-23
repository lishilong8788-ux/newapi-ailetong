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
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { formatLatency } from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import type { MessageAlignment } from '../../lib'
import type { Message } from '../../types'

type MessageMetadataProps = {
  alignment: MessageAlignment
  message: Message
}

function formatMessageTime(timestamp?: number): string | undefined {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return undefined
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function formatDuration(
  durationMs: number | undefined,
  t: TFunction
): string | undefined {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    return undefined
  }

  if (durationMs < 1000) {
    return t('{{value}}ms', { value: Math.max(1, Math.round(durationMs)) })
  }

  return t('{{value}}s', { value: (durationMs / 1000).toFixed(2) })
}

export function MessageMetadata(props: MessageMetadataProps) {
  const { t } = useTranslation()
  const messageTime = formatMessageTime(props.message.createdAt)
  const duration = formatDuration(props.message.durationMs, t)
  const channel = props.message.channel
  const ttftMs = props.message.ttftMs

  /*
   * Segments, so an absent one leaves no separator behind and no placeholder.
   * Channel and first-token time are both routinely unknown — a reply predating
   * these fields, a response whose headers were unreadable, a non-streaming
   * request — and a dash standing in for either would read as a measurement of
   * nothing.
   */
  const segments: Array<{ key: string; node: ReactNode }> = []

  if (messageTime) {
    segments.push({ key: 'time', node: <time>{messageTime}</time> })
  }

  if (duration) {
    // The label moved to the tooltip: with four segments on one line, spelling
    // out "Response time" crowded out the three that are new here.
    segments.push({
      key: 'duration',
      node: (
        <span title={t('Response time: {{duration}}', { duration })}>
          {duration}
        </span>
      ),
    })
  }

  if (channel) {
    segments.push({
      key: 'channel',
      node: (
        <span>
          {t('via {{channel}}', {
            channel: channel.code || `#${channel.id}`,
          })}
        </span>
      ),
    })
  }

  if (ttftMs !== undefined) {
    segments.push({
      key: 'ttft',
      node: (
        <span>
          {t('First token {{value}}', { value: formatLatency(ttftMs) })}
        </span>
      ),
    })
  }

  if (segments.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'text-muted-foreground mt-1 flex min-h-4 items-center gap-1.5 text-[11px] leading-none',
        props.alignment === 'right' && 'justify-end'
      )}
    >
      {segments.map((segment, index) => (
        <span className='flex items-center gap-1.5' key={segment.key}>
          {index > 0 && <span aria-hidden='true'>·</span>}
          {segment.node}
        </span>
      ))}
    </div>
  )
}
