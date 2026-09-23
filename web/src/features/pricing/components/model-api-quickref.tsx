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
import { ArrowRight, ChevronRight, Link2, Plug, Tag } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import { getClientModelName } from '../lib/channel-price'
import { replaceModelInPath } from '../lib/model-helpers'
import type { PricingModel } from '../types'
import { ApiKeyStep } from './model-api-key-step'
import { CopyableRow, StepCard } from './model-api-steps'
import { FieldPlaceholder } from './model-details-shared'

// ----------------------------------------------------------------------------
// Endpoint copy
// ----------------------------------------------------------------------------
//
// Every endpoint row carries one line of "when do I use this". Without it the
// panel is a wall of near-identical URLs — an aggregator channel advertises six
// of them for every model it carries (see common/endpoint_type.go), so the
// reader's real question is never "what is the URL" but "which one of these six
// is mine". The answer is the client they already use, so that is what each
// line names.
const ENDPOINT_USAGE_KEYS: Record<string, string> = {
  openai:
    'Chat completions. Use this one for tools that ask for a full URL — OpenClaw, Dify, Cherry Studio, Chatbox, LobeChat — together with the model name from step 2 and the key from step 3.',
  'openai-response':
    'OpenAI Responses API. Required by Codex and by SDK calls that use client.responses.create.',
  'openai-response-compact':
    'Compact variant of the Responses API, for clients that cannot handle the full event stream.',
  'openai-alpha-search':
    'Search-augmented completions. The upstream contract can still change without notice.',
  anthropic:
    'Anthropic Messages API. Use this one for Claude Code and the Anthropic SDK; it also accepts the x-api-key header.',
  gemini:
    'Gemini generateContent. Use this one for the Google Generative AI SDK.',
  embeddings: 'Vector embeddings, for retrieval and similarity search.',
  'jina-rerank': 'Reranking, for reordering retrieval candidates.',
  'image-generation': 'Image generation.',
  'openai-video': 'Video generation, submitted as an asynchronous task.',
  'audio-transcription': 'Speech to text.',
}

/** Endpoints whose upstream contract is not yet stable. */
const EXPERIMENTAL_ENDPOINTS = new Set(['openai-alpha-search'])

type ResolvedEndpoint = {
  type: string
  url: string
  method: string
  experimental: boolean
}

export interface ModelApiQuickrefProps {
  model: PricingModel
  endpointMap: Record<string, { path?: string; method?: string }>
  /** Switches the details view to its API tab, where the code samples live. */
  onViewCodeSamples?: () => void
  title?: string
  badgeText?: string
  subtitle?: string
  /**
   * How many channels can serve this model, for step 2's failover sentence. 0
   * and 1 both suppress it: with one line there is nothing to fail over to.
   */
  routeCount?: number
  /**
   * The line this panel is documenting, when it sits beside one channel's prices.
   * Step 2 then offers `<model>/<code>` — the string that actually reaches that
   * line — instead of the bare model name, which would send the reader to
   * whichever channel the router picked and quote them the wrong price.
   */
  lineCode?: string
  /**
   * The panel is documenting one channel and that channel publishes no line code.
   * Distinct from `lineCode` being absent because the panel is documenting the
   * model as a whole: here the reader picked a line and needs to be told it
   * cannot be named, rather than being handed a bare model name with no
   * explanation of where their selection went.
   */
  lineCodeMissing?: boolean
}

/**
 * The three things a reader needs in order to call this model: where to send the
 * request, what to put in `model`, and which key to sign it with.
 *
 * Numbered rather than listed. The panel this replaced put a base URL, six
 * endpoint dialects and an auth header in one flat stack, which is accurate and
 * unreadable — a customer looking at seven URLs cannot tell that six of them are
 * alternatives to each other and that they need exactly one. So the primary
 * endpoint is promoted next to the base URL as "copy either of these", the
 * remaining dialects fold away behind a count, and each one says which client it
 * belongs to.
 *
 * The promoted endpoint is `supported_endpoint_types[0]`, which the backend
 * documents as the preferred one (model/pricing.go — "第一个端点是优先使用端点").
 * That makes the promotion a backend contract rather than a guess this component
 * makes about protocol precedence.
 */
export function ModelApiQuickref(props: ModelApiQuickrefProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const [showAll, setShowAll] = useState(false)

  const baseUrl = useMemo(() => {
    const candidate =
      (status as Record<string, unknown> | null)?.server_address ??
      (status?.data as Record<string, unknown> | undefined)?.server_address
    if (candidate && typeof candidate === 'string') {
      return candidate.replace(/\/$/, '')
    }
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [status])

  // What goes in `model`, and in the one endpoint dialect that carries the model
  // in its URL instead. With a line pinned the two have to agree — a Gemini URL
  // built from the bare name would drop the pin while step 2 still promised it.
  const clientModelName = getClientModelName(
    props.model.model_name || '',
    props.lineCode
  )

  const endpoints = useMemo<ResolvedEndpoint[]>(() => {
    const types = props.model.supported_endpoint_types || []
    return types
      .map((type) => {
        const info = props.endpointMap[type] || {}
        const path = info.path
          ? replaceModelInPath(info.path, clientModelName)
          : ''
        return {
          type,
          url: path ? `${baseUrl}${path}` : '',
          method: info.method || 'POST',
          experimental: EXPERIMENTAL_ENDPOINTS.has(type),
        }
      })
      .filter((entry) => Boolean(entry.url))
  }, [props.model, props.endpointMap, baseUrl, clientModelName])

  const [primary, ...alternates] = endpoints
  const routeCount = props.routeCount ?? 0

  return (
    // One card, not three floating siblings. The steps are segments inside it,
    // divided by hairlines — an enclosing surface is what makes the block read
    // as a single object, and it is the reason the panel now has anything to
    // cast a shadow onto the tinted page behind it.
    <div className='bg-card border-border/70 shadow-raised overflow-hidden rounded-2xl border'>
      <header className='from-primary/[0.07] border-border/60 flex flex-wrap items-start justify-between gap-2 border-b bg-linear-to-r to-transparent px-4 py-3'>
        <div className='flex min-w-0 items-center gap-2.5'>
          {/* A saturated gradient tile, not a 15%-tint wash. At 15% over white
              the brand colour was washing out to grey; the panel is otherwise
              all monospace, so this tile and the step pills are the only places
              carrying colour, and they have to actually land. */}
          <span className='from-primary ring-primary/20 flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br to-[oklch(0.62_0.17_262)] shadow-sm ring-1'>
            <Plug className='size-4 text-white' aria-hidden />
          </span>
          <div className='min-w-0'>
            <div className='flex min-w-0 items-center gap-1.5'>
              <h2 className='truncate text-[15px] font-semibold tracking-tight'>
                {props.title ?? t('How to connect')}
              </h2>
              {props.badgeText && (
                <Badge
                  variant='secondary'
                  className='bg-primary/10 text-primary border-primary/20 shrink-0 text-[10px] font-semibold'
                >
                  {props.badgeText}
                </Badge>
              )}
            </div>
            {props.subtitle && (
              <p className='text-muted-foreground mt-0.5 text-xs leading-relaxed'>
                {props.subtitle}
              </p>
            )}
          </div>
        </div>
        {props.onViewCodeSamples && (
          // Solid primary, not an outlined ghost: the block needs exactly one
          // visual anchor, and the only forward action in it is this one.
          <button
            type='button'
            onClick={props.onViewCodeSamples}
            className='bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none'
          >
            {t('View code samples')}
            <ArrowRight className='size-3.5' />
          </button>
        )}
      </header>

      <StepCard
        index={1}
        icon={Link2}
        title={t('Endpoint address')}
        hint={t('Copy whichever one your client asks for.')}
        trailing={
          primary ? (
            <Badge
              variant='secondary'
              className='shrink-0 text-[10px] font-normal'
            >
              {t('Either one works')}
            </Badge>
          ) : undefined
        }
      >
        {baseUrl ? (
          <CopyableRow
            label={t('Base URL')}
            value={baseUrl}
            dotted
            copyLabel={t('Copy base URL')}
            trailingLabel={
              <span className='text-muted-foreground text-[10px] font-medium'>
                {t('For SDKs')}
              </span>
            }
            usageKey='Base address. Use this one for the official SDKs and for tools that ask for a "base URL" and append the path themselves.'
          />
        ) : (
          <div className='bg-primary/[0.045] ring-primary/12 rounded-xl px-3 py-2.5 ring-1'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Base URL')}
            </span>
            <div className='mt-1'>
              <FieldPlaceholder className='text-sm' />
            </div>
          </div>
        )}

        {primary ? (
          <CopyableRow
            label={primary.type}
            value={primary.url}
            method={primary.method}
            dotted
            copyLabel={t('Copy endpoint URL')}
            trailingLabel={
              <span className='text-muted-foreground text-[10px] font-medium'>
                {t('Full endpoint')}
              </span>
            }
            usageKey={ENDPOINT_USAGE_KEYS[primary.type]}
          />
        ) : (
          <div className='bg-primary/[0.045] ring-primary/12 rounded-xl px-3 py-2.5 ring-1'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Endpoints')}
            </span>
            <p className='text-muted-foreground mt-1 text-sm'>
              {t('No endpoint is configured for this model yet.')}
            </p>
          </div>
        )}

        {alternates.length > 0 && (
          <Collapsible open={showAll} onOpenChange={setShowAll}>
            <CollapsibleTrigger className='text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/[0.03] border-border flex w-full items-center gap-1.5 rounded-xl border border-dashed px-3 py-2 text-xs transition-colors'>
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 transition-transform',
                  showAll && 'rotate-90'
                )}
                aria-hidden
              />
              <span className='shrink-0 font-medium'>
                {t('Other protocol endpoints')}
              </span>
              <span className='bg-primary/10 text-primary shrink-0 rounded px-1.5 font-mono text-[10px] font-semibold tabular-nums'>
                {alternates.length}
              </span>
              <span className='text-muted-foreground min-w-0 truncate font-mono text-[11px]'>
                {alternates.map((entry) => entry.type).join(' · ')}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className='mt-1.5 space-y-1.5'>
                {alternates.map((endpoint) => (
                  <CopyableRow
                    key={endpoint.type}
                    label={endpoint.type}
                    value={endpoint.url}
                    method={endpoint.method}
                    copyLabel={t('Copy endpoint URL')}
                    trailingLabel={
                      endpoint.experimental ? (
                        <Badge
                          variant='outline'
                          className='h-5 border-amber-500/40 px-1.5 text-[10px] font-normal text-amber-600 dark:text-amber-400'
                        >
                          {t('Experimental')}
                        </Badge>
                      ) : undefined
                    }
                    usageKey={ENDPOINT_USAGE_KEYS[endpoint.type]}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </StepCard>

      <StepCard
        index={2}
        icon={Tag}
        title={t('Model name')}
        hint={t('Put this exact string in the request body’s model field.')}
        trailing={
          props.lineCode ? (
            <Badge
              variant='secondary'
              className='bg-primary/10 text-primary border-primary/20 shrink-0 font-mono text-[10px] font-semibold'
            >
              {props.lineCode}
            </Badge>
          ) : undefined
        }
      >
        <CopyableRow
          label={t('Model')}
          value={clientModelName}
          dotted
          copyLabel={t('Copy model name')}
        />
        {/* Three different situations, three different sentences. A reader who
            picked a line needs to know the suffix is what pins it and that the
            platform will still answer if that line is down; a reader on one whose
            operator gave it no code needs to know why there is no suffix to copy;
            and a reader on automatic routing needs to know the name is the same
            whichever channel serves them. */}
        {props.lineCode && (
          <p className='text-muted-foreground px-0.5 text-[11px] leading-relaxed'>
            {t(
              'The /{{code}} suffix pins this line. Requests still switch to another channel when it is unavailable, and the price you are charged is that channel’s own.',
              { code: props.lineCode }
            )}
          </p>
        )}
        {!props.lineCode && props.lineCodeMissing && (
          <p className='text-muted-foreground px-0.5 text-[11px] leading-relaxed'>
            {t(
              'This line has no line code, so it cannot be named in a request — it is reached through automatic routing only.'
            )}
          </p>
        )}
        {!props.lineCode && !props.lineCodeMissing && routeCount > 1 && (
          <p className='text-muted-foreground px-0.5 text-[11px] leading-relaxed'>
            {t(
              '{{count}} channels can serve this model. The platform picks one for you and retries on the next one if a request fails — the model name stays the same either way.',
              { count: routeCount }
            )}
          </p>
        )}
      </StepCard>

      <ApiKeyStep index={3} />
    </div>
  )
}
