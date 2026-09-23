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
import { ExternalLink, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatLatency } from '@/features/performance-metrics/lib/format'
import { getChannelDiscount, getChannelLabel } from '@/features/pricing/lib'
import type { AutoRouteInfo, ChannelCategory, ChannelRoute } from '@/features/pricing/types'
import { formatDiscount } from '@/lib/format'

const CATEGORY_LABEL_KEYS: Record<ChannelCategory, string> = {
  vendor: 'Model vendor',
  public_cloud: 'Public cloud',
  aggregator: 'Aggregator',
  self_hosted: 'Self-hosted',
  other: 'Other route',
}

export interface CatalogChannelTableProps {
  modelName: string
  routes: ChannelRoute[]
  autoRoute?: AutoRouteInfo
  isLoading: boolean
  /** Channels whose model list contains this model, including disabled ones. */
  configuredCount: number
}

/**
 * The supply side for one model: every line that can serve it, cheapest first.
 *
 * Read-only on purpose. A channel row looks per-model but almost none of a
 * channel's fields are: priority, weight, groups and the key are channel-wide, so
 * an inline edit here would silently retune every other model on that line. The
 * only genuinely per-(channel, model) settings are the sell discount and the
 * model mapping, and both live in the channel drawer — so every row links there
 * instead of pretending to be editable.
 *
 * `routes` comes from `/api/pricing/channels`, which lists only channels with a
 * live ability. `configuredCount` is counted off raw channel config, so the gap
 * between the two is exactly the set of lines that are configured but not
 * serving — which is worth stating rather than leaving as a short table.
 */
export function CatalogChannelTable(props: CatalogChannelTableProps) {
  const { t } = useTranslation()
  const servingCount = props.routes.length
  const idleCount = Math.max(props.configuredCount - servingCount, 0)

  return (
    <section className='bg-card rounded-xl border'>
      <header className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <h3 className='text-sm font-semibold'>{t('Supply')}</h3>
          <span className='text-muted-foreground text-xs'>
            {t('{{count}} lines serving', { count: servingCount })}
            {idleCount > 0 &&
              ` · ${t('{{count}} configured but idle', { count: idleCount })}`}
          </span>
          {props.autoRoute?.enabled && (
            <Badge variant='outline' className='gap-1'>
              <Zap className='size-3' />
              {props.autoRoute.ranked
                ? t('Lowest-price routing')
                : t('Lowest-price routing (no price spread)')}
            </Badge>
          )}
        </div>
        <Button
          variant='outline'
          size='xs'
          render={
            <Link to='/channels' search={{ model: props.modelName }} />
          }
        >
          <ExternalLink />
          {t('Manage channels')}
        </Button>
      </header>

      {props.isLoading && (
        <div className='space-y-2 p-4'>
          <Skeleton className='h-8 w-full' />
          <Skeleton className='h-8 w-full' />
        </div>
      )}

      {!props.isLoading && servingCount === 0 && (
        <p className='text-muted-foreground px-4 py-6 text-center text-sm'>
          {t('No enabled channel serves this model.')}
        </p>
      )}

      {!props.isLoading && servingCount > 0 && (
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='text-muted-foreground text-xs'>
                <th scope='col' className='px-4 py-2 text-left font-medium'>
                  {t('Line')}
                </th>
                <th scope='col' className='px-4 py-2 text-left font-medium'>
                  {t('Category')}
                </th>
                <th scope='col' className='px-4 py-2 text-left font-medium'>
                  {t('Groups')}
                </th>
                <th scope='col' className='px-4 py-2 text-left font-medium'>
                  {t('Upstream model')}
                </th>
                <th scope='col' className='px-4 py-2 text-right font-medium'>
                  {t('Latency')}
                </th>
                <th scope='col' className='px-4 py-2 text-right font-medium'>
                  {t('Reported discount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {props.routes.map((route) => {
                const discount = getChannelDiscount(route)
                const formatted =
                  discount == null ? null : formatDiscount(discount, t)
                return (
                  <tr key={route.channel_id} className='border-t'>
                    <td className='px-4 py-2'>
                      <Link
                        to='/channels'
                        search={{ filter: String(route.channel_id) }}
                        className='font-mono font-medium hover:underline'
                      >
                        {getChannelLabel(route)}
                      </Link>
                    </td>
                    <td className='text-muted-foreground px-4 py-2 text-xs'>
                      {t(
                        CATEGORY_LABEL_KEYS[route.category] ??
                          CATEGORY_LABEL_KEYS.other
                      )}
                    </td>
                    <td className='px-4 py-2'>
                      <div className='flex flex-wrap gap-1'>
                        {(route.groups ?? []).map((group) => (
                          <GroupBadge key={group} group={group} size='sm' />
                        ))}
                      </div>
                    </td>
                    <td className='text-muted-foreground px-4 py-2 font-mono text-xs'>
                      {route.price.upstream_model || props.modelName}
                    </td>
                    <td className='px-4 py-2 text-right tabular-nums'>
                      {route.latency_ms
                        ? formatLatency(route.latency_ms)
                        : <span className='text-muted-foreground'>-</span>}
                    </td>
                    <td className='px-4 py-2 text-right tabular-nums'>
                      {formatted ? (
                        <span className='font-medium text-orange-600 dark:text-orange-400'>
                          {formatted}
                        </span>
                      ) : (
                        <span className='text-muted-foreground'>-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className='text-muted-foreground border-t px-4 py-2 text-xs'>
        {t(
          'Per-channel discounts are recorded for margin reporting and do not change what a customer is billed.'
        )}
      </p>
    </section>
  )
}
