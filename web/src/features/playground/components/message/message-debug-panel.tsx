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
import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { formatLatency } from '@/features/performance-metrics/lib/format'
import { useChannelPricing } from '@/features/pricing/hooks'
import type { ChannelCategory } from '@/features/pricing/types'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import type { Message } from '../../types'

/**
 * Category wording, mirroring the private `CATEGORY_LABEL_KEYS` in
 * `features/pricing/components/channel-route-detail.tsx`.
 *
 * A copy rather than an import because that one is module-private and the file
 * belongs to the pricing feature. Not exported from here either — a component
 * module that also exports constants breaks fast refresh — so `playground-topbar`
 * carries its own copy. Collapse all three the moment the pricing feature
 * exports a shared map: the strings are already identical, and drifting apart
 * would show one channel under two different names.
 */
const CHANNEL_CATEGORY_LABEL_KEYS: Record<ChannelCategory, string> = {
  vendor: 'Model vendor',
  public_cloud: 'Public cloud',
  aggregator: 'Aggregator',
  self_hosted: 'Self-hosted',
  other: 'Other route',
}

/** Token counts for one reply, as the OpenAI-shaped response reports them. */
export type MessageUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface MessageDebugPanelProps {
  message: Message
  /** The model this reply came from, for the channel's published figures. */
  modelName?: string
  /**
   * Token counts, when the transport reported any.
   *
   * Absent is the normal case on a streamed reply — the upstream only sends a
   * usage chunk when asked — and an absent count removes the row rather than
   * rendering zeros, which would read as "this reply cost nothing".
   */
  usage?: MessageUsage
  /**
   * The gateway's own request id, from the `X-Oneapi-Request-Id` response header
   * that `middleware.RequestId()` sets on every route.
   *
   * Worth showing only because it is the *server's* id and the same value is
   * written into the consume log, so pasting it into a support conversation
   * actually finds the request. A front-end generated id would look like the same
   * affordance and match nothing.
   */
  requestId?: string
  /** For the trigger's `aria-controls`. */
  id?: string
}

function DebugRow(props: { label: string; children: ReactNode }) {
  return (
    <div className='flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3'>
      <dt className='text-muted-foreground w-12 shrink-0 text-[11px]'>
        {props.label}
      </dt>
      <dd className='flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs'>
        {props.children}
      </dd>
    </div>
  )
}

function DebugValue(props: { children: ReactNode }) {
  return <span className='font-mono tabular-nums'>{props.children}</span>
}

/** One `label value` pair within a row, named so it can carry a stable key. */
type DebugSegment = { key: string; node: ReactNode }

/** Joins segments with `·`, so an omitted segment leaves no stray separator. */
function DebugSegments(props: { segments: DebugSegment[] }) {
  return props.segments.map((segment, index) => (
    <span className='flex items-baseline gap-2' key={segment.key}>
      {index > 0 && (
        <span aria-hidden='true' className='text-muted-foreground/60'>
          ·
        </span>
      )}
      {segment.node}
    </span>
  ))
}

function MessageDebugRequestIdRow(props: { requestId: string }) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard()
  const isCopied = copiedText === props.requestId

  return (
    <DebugRow label={t('Request ID')}>
      <DebugValue>{props.requestId}</DebugValue>
      <Button
        aria-label={t('Copy')}
        className='text-muted-foreground hover:text-foreground size-6'
        onClick={() => copyToClipboard(props.requestId)}
        size='icon-xs'
        variant='ghost'
      >
        {isCopied ? (
          <Check aria-hidden='true' className='size-3 text-green-600' />
        ) : (
          <Copy aria-hidden='true' className='size-3' />
        )}
      </Button>
    </DebugRow>
  )
}

/** Token counts, per field, skipping any the transport did not report. */
function MessageDebugUsageRow(props: { usage: MessageUsage }) {
  const { t } = useTranslation()
  const segments: DebugSegment[] = []

  const fields: Array<[string, number | undefined]> = [
    ['Input', props.usage.prompt_tokens],
    ['Output', props.usage.completion_tokens],
    ['Total', props.usage.total_tokens],
  ]

  for (const [label, value] of fields) {
    if (value === undefined) continue
    segments.push({
      key: label,
      node: (
        <>
          <span className='text-muted-foreground'>{t(label)}</span>
          <DebugValue>{t('{{value}} tokens', { value })}</DebugValue>
        </>
      ),
    })
  }

  if (segments.length === 0) return null

  return (
    <DebugRow label={t('Usage')}>
      <DebugSegments segments={segments} />
    </DebugRow>
  )
}

/**
 * This run against what the channel card advertises.
 *
 * Both numbers go through `formatLatency`, the same formatter the card uses, so
 * the pair is comparable rather than merely adjacent. With no published figure
 * the row shows the measurement alone — inventing a baseline to compare against
 * would defeat the point of the comparison.
 */
function MessageDebugBenchmarkRow(props: {
  ttftMs?: number
  nominalTtftMs?: number
}) {
  const { t } = useTranslation()

  if (props.ttftMs === undefined) {
    return (
      <DebugRow label={t('Benchmark')}>
        <span className='text-muted-foreground'>
          {t('Non-streaming request, no first token to measure')}
        </span>
      </DebugRow>
    )
  }

  const deltaMs =
    props.nominalTtftMs !== undefined
      ? Math.round(props.ttftMs - props.nominalTtftMs)
      : undefined

  return (
    <DebugRow label={t('Benchmark')}>
      {props.nominalTtftMs !== undefined && (
        <>
          <span className='text-muted-foreground'>{t('Card estimate')}</span>
          <DebugValue>{formatLatency(props.nominalTtftMs)}</DebugValue>
          <span aria-hidden='true' className='text-muted-foreground/60'>
            →
          </span>
        </>
      )}
      <span className='text-muted-foreground'>{t('This run')}</span>
      <DebugValue>{formatLatency(props.ttftMs)}</DebugValue>
      {deltaMs !== undefined && deltaMs !== 0 && (
        <DebugValue>
          <span className='text-muted-foreground'>
            ({deltaMs > 0 ? '+' : '-'}
            {formatLatency(Math.abs(deltaMs))})
          </span>
        </DebugValue>
      )}
    </DebugRow>
  )
}

function MessageDebugTimingRow(props: {
  ttftMs?: number
  durationMs?: number
  throughput?: number
}) {
  const { t } = useTranslation()
  const segments: DebugSegment[] = []

  if (props.ttftMs !== undefined) {
    segments.push({
      key: 'ttft',
      node: (
        <>
          <span className='text-muted-foreground'>{t('First token')}</span>
          <DebugValue>{formatLatency(props.ttftMs)}</DebugValue>
        </>
      ),
    })
  }

  if (props.durationMs !== undefined) {
    segments.push({
      key: 'total',
      node: (
        <>
          <span className='text-muted-foreground'>{t('Total')}</span>
          <DebugValue>{formatLatency(props.durationMs)}</DebugValue>
        </>
      ),
    })
  }

  if (props.throughput !== undefined) {
    segments.push({
      key: 'throughput',
      node: (
        <>
          <span className='text-muted-foreground'>{t('Output')}</span>
          <DebugValue>
            {t('{{value}} token/s', { value: Math.round(props.throughput) })}
          </DebugValue>
        </>
      ),
    })
  }

  if (segments.length === 0) return null

  return (
    <DebugRow label={t('Timing')}>
      <DebugSegments segments={segments} />
    </DebugRow>
  )
}

/**
 * Which line served the reply, and whether that was the one asked for.
 *
 * `pinned` is rendered as its own clause because the failure it guards against
 * is silent: a pin that fell through to another channel otherwise looks exactly
 * like a pin that held, and checking the pin held is the entire reason for
 * pinning.
 */
function MessageDebugChannelRow(props: {
  channel: Message['channel']
  route?: { category?: ChannelCategory }
}) {
  const { t } = useTranslation()

  if (!props.channel) {
    return (
      <DebugRow label={t('Channel')}>
        <span className='text-muted-foreground'>
          {t('The channel for this reply is unknown')}
        </span>
      </DebugRow>
    )
  }

  const category = props.route?.category
  const segments: DebugSegment[] = [
    {
      key: 'channel',
      node: (
        <DebugValue>
          {props.channel.code
            ? `${props.channel.code} (#${props.channel.id})`
            : `#${props.channel.id}`}
        </DebugValue>
      ),
    },
  ]

  if (category) {
    segments.push({
      key: 'category',
      node: <span>{t(CHANNEL_CATEGORY_LABEL_KEYS[category])}</span>,
    })
  }

  segments.push({
    key: 'pinned',
    node: (
      <span>
        {props.channel.pinned ? t('You pinned this') : t('Chosen by routing')}
      </span>
    ),
  })

  return (
    <DebugRow label={t('Channel')}>
      <DebugSegments segments={segments} />
    </DebugRow>
  )
}

/**
 * What actually happened on one reply: which line served it, how fast it
 * started, and how that compares to what the channel card advertises.
 *
 * The comparison is the reason this exists. A channel card's first-token figure
 * is a 7-day mean over other people's traffic; this is the same measurement on
 * the request in front of you, so a line that is slower than advertised becomes
 * visible instead of being taken on trust.
 *
 * Deliberately not here: cost. A client-side `tokens x rate` misses group
 * ratios, cache pricing and per-request billing, and in a billing context a
 * confidently wrong number is worse than no number. The usage log has the real
 * figure.
 */
export function MessageDebugPanel(props: MessageDebugPanelProps) {
  const { routes } = useChannelPricing(props.modelName)

  const channel = props.message.channel
  const route = channel
    ? routes.find((candidate) => candidate.channel_id === channel.id)
    : undefined

  const ttftMs = props.message.ttftMs
  const durationMs = props.message.durationMs
  const nominalTtftMs = route?.ttft_ms
  const completionTokens = props.usage?.completion_tokens

  /*
   * Tokens per second over the generation phase only: the wait for the first
   * token is not time spent producing tokens, so leaving it in would report a
   * slow-starting channel as a slow-generating one. Needs a real output count —
   * estimating from character length would silently invent a figure.
   */
  const generationMs =
    durationMs !== undefined && ttftMs !== undefined
      ? durationMs - ttftMs
      : undefined
  const throughput =
    completionTokens !== undefined &&
    completionTokens > 0 &&
    generationMs !== undefined &&
    generationMs > 0
      ? (completionTokens / generationMs) * 1000
      : undefined

  return (
    <div className='bg-card mt-2 rounded-xl border p-4' id={props.id}>
      <dl className='flex flex-col gap-2'>
        <MessageDebugChannelRow channel={channel} route={route} />
        <MessageDebugTimingRow
          durationMs={durationMs}
          throughput={throughput}
          ttftMs={ttftMs}
        />
        <MessageDebugBenchmarkRow
          nominalTtftMs={nominalTtftMs}
          ttftMs={ttftMs}
        />
        {props.usage && <MessageDebugUsageRow usage={props.usage} />}
        {props.requestId && (
          <MessageDebugRequestIdRow requestId={props.requestId} />
        )}
      </dl>
    </div>
  )
}
