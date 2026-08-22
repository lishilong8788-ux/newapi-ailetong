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
import { Link } from '@tanstack/react-router'
import { ArrowRight, KeyRound, Plug } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { useStatus } from '@/hooks/use-status'

import { replaceModelInPath } from '../lib/model-helpers'
import type { PricingModel } from '../types'
import { FieldPlaceholder } from './model-details-shared'

export interface ModelApiQuickrefProps {
  model: PricingModel
  endpointMap: Record<string, { path?: string; method?: string }>
  /** Switches the details view to its API tab, where the code samples live. */
  onViewCodeSamples?: () => void
}

function AccessRow(props: {
  label: React.ReactNode
  url: string
  method?: string
}) {
  const { t } = useTranslation()

  return (
    <div className='px-3 py-2.5'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-muted-foreground min-w-0 truncate text-[11px] font-medium tracking-wider uppercase'>
          {props.label}
        </span>
        {props.method && (
          <Badge
            variant='secondary'
            className='h-5 shrink-0 px-1.5 font-mono text-[10px] font-normal'
          >
            {props.method}
          </Badge>
        )}
      </div>
      <div className='mt-1 flex items-start gap-1.5'>
        {/* Wraps rather than truncates: this is the one string on the page a
            reader needs in full, and the old narrow sidebar clipped every URL
            past the host. `break-all` because paths have no spaces to break on. */}
        <code className='text-foreground min-w-0 flex-1 font-mono text-[13px] leading-relaxed break-all'>
          {props.url}
        </code>
        <CopyButton
          value={props.url}
          variant='outline'
          className='hover:border-primary hover:text-primary size-10 shrink-0'
          iconClassName='size-4.5'
          tooltip={t('Copy')}
          notify
        />
      </div>
    </div>
  )
}

/**
 * Everything needed to point a client at this model: base URL, one row per
 * endpoint dialect it accepts, the auth header, and the two next steps.
 *
 * Promoted out of the 280px sidebar it used to share with the price table. The
 * URLs are the most copy-pasted strings on the page and every one of them was
 * being truncated mid-host to fit that column.
 */
export function ModelApiQuickref(props: ModelApiQuickrefProps) {
  const { t } = useTranslation()
  const { status } = useStatus()

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

  const endpoints = useMemo(() => {
    const types = props.model.supported_endpoint_types || []
    return types
      .map((type) => {
        const info = props.endpointMap[type] || {}
        const path = info.path
          ? replaceModelInPath(info.path, props.model.model_name || '')
          : ''
        return { type, path, method: info.method || 'POST' }
      })
      .filter((entry) => Boolean(entry.path))
  }, [props.model, props.endpointMap])

  return (
    <section>
      <div className='bg-card overflow-hidden rounded-xl border'>
        <header className='bg-muted/30 flex items-center gap-1.5 border-b px-3 py-2'>
          <Plug className='text-muted-foreground/70 size-3.5' />
          <h3 className='text-sm font-semibold'>{t('How to connect')}</h3>
        </header>

        <div className='divide-border/60 divide-y'>
          {baseUrl ? (
            <AccessRow label={t('Base URL')} url={baseUrl} />
          ) : (
            <div className='px-3 py-2.5'>
              <span className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
                {t('Base URL')}
              </span>
              <div className='mt-1'>
                <FieldPlaceholder className='text-sm' />
              </div>
            </div>
          )}

          {endpoints.length > 0 ? (
            endpoints.map((endpoint) => (
              <AccessRow
                key={endpoint.type}
                label={endpoint.type}
                url={`${baseUrl}${endpoint.path}`}
                method={endpoint.method}
              />
            ))
          ) : (
            <div className='px-3 py-2.5'>
              <span className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
                {t('Endpoints')}
              </span>
              <p className='text-muted-foreground/50 mt-1 text-sm'>
                {t('No endpoint is configured for this model yet.')}
              </p>
            </div>
          )}

          <div className='px-3 py-2.5'>
            <span className='text-muted-foreground inline-flex items-center gap-1 text-[11px] font-medium tracking-wider uppercase'>
              <KeyRound className='size-3' />
              {t('Authentication')}
            </span>
            <code className='text-foreground mt-1 block font-mono text-[13px] break-all'>
              Authorization: Bearer &lt;YOUR_API_KEY&gt;
            </code>
          </div>
        </div>

        <footer className='bg-muted/20 flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2.5'>
          {props.onViewCodeSamples && (
            <button
              type='button'
              onClick={props.onViewCodeSamples}
              className='text-info hover:text-info/80 inline-flex items-center gap-1 text-xs font-medium transition-colors'
            >
              {t('View code samples')}
              <ArrowRight className='size-3' />
            </button>
          )}
          <Link
            to='/keys'
            className='text-info hover:text-info/80 inline-flex items-center gap-1 text-xs font-medium transition-colors'
          >
            {t('Create API key')}
            <ArrowRight className='size-3' />
          </Link>
        </footer>
      </div>
    </section>
  )
}
