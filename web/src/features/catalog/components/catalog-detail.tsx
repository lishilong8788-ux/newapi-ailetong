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
import { Boxes, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { GroupBadge } from '@/components/group-badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useChannelPricing } from '@/features/pricing/hooks'
import { getLobeIcon } from '@/lib/lobe-icon'

import { CATALOG_STATUS_META } from '../lib/catalog-status'
import type { CatalogItem } from '../types'
import { CatalogChannelTable } from './catalog-channel-table'
import { CatalogPriceSummary } from './catalog-price-summary'
import { CatalogStatusDot } from './catalog-status-dot'

export interface CatalogDetailProps {
  item: CatalogItem
  groupRatio: Record<string, number>
  priceRate: number
  usdExchangeRate: number
  className?: string
}

/**
 * One product: what state it is in, what it costs, and who supplies it.
 *
 * Laid out in the order an operator asks the questions — is it sellable, is the
 * price right, is there supply — rather than in the order the data arrives.
 */
export function CatalogDetail(props: CatalogDetailProps) {
  const { t } = useTranslation()
  const { item } = props
  const { routes, autoRoute, isLoading } = useChannelPricing(item.modelName)
  const statusMeta = CATALOG_STATUS_META[item.status]

  const tags = (item.pricing?.tags ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

  const icon = item.pricing?.icon || item.vendorIcon

  return (
    <ScrollArea className={props.className}>
      <div className='space-y-4 pr-1'>
        <header className='bg-card rounded-xl border p-4'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0 space-y-1.5'>
              <div className='flex min-w-0 items-center gap-2'>
                {icon && <span className='shrink-0'>{getLobeIcon(icon, 20)}</span>}
                <h2 className='truncate font-mono text-base font-bold'>
                  {item.modelName}
                </h2>
                <span className='flex shrink-0 items-center gap-1.5'>
                  <CatalogStatusDot status={item.status} />
                  <span className={`text-xs font-medium ${statusMeta.textClass}`}>
                    {t(statusMeta.labelKey)}
                  </span>
                </span>
              </div>
              <p className='text-muted-foreground text-xs'>
                {item.vendorName}
                {item.pricing?.description ? ` · ${item.pricing.description}` : ''}
              </p>
              {tags.length > 0 && (
                <div className='flex flex-wrap gap-1 pt-0.5'>
                  {tags.map((tag) => (
                    <Badge key={tag} variant='secondary' className='text-[11px]'>
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <Button
              variant='outline'
              size='xs'
              render={
                <Link to='/models/$section' params={{ section: 'metadata' }} />
              }
            >
              <Pencil />
              {t('Edit product info')}
            </Button>
          </div>

          {/* The state description doubles as the fix instruction for every state
              that needs one, so it is spelled out here rather than hidden in the
              left rail's tooltip. */}
          {item.status !== 'on_sale' && (
            <p className='text-muted-foreground mt-3 border-t pt-3 text-xs'>
              {t(statusMeta.descriptionKey)}
            </p>
          )}

          {item.pricing && (
            <div className='mt-3 flex flex-wrap items-center gap-2 border-t pt-3'>
              <span className='text-muted-foreground inline-flex items-center gap-1 text-xs'>
                <Boxes className='size-3.5' />
                {t('Sold to')}
              </span>
              {item.pricing.enable_groups.map((group) => (
                <GroupBadge
                  key={group}
                  group={group}
                  ratio={props.groupRatio[group]}
                  size='sm'
                />
              ))}
            </div>
          )}
        </header>

        {item.pricing ? (
          <CatalogPriceSummary
            model={item.pricing}
            priceRate={props.priceRate}
            usdExchangeRate={props.usdExchangeRate}
          />
        ) : (
          <section className='bg-card rounded-xl border px-4 py-6 text-center'>
            <p className='text-muted-foreground text-sm'>
              {t('This model is not in the sell-side catalog, so it has no price.')}
            </p>
          </section>
        )}

        <CatalogChannelTable
          modelName={item.modelName}
          routes={routes}
          autoRoute={autoRoute}
          isLoading={isLoading}
          configuredCount={item.channelCount}
        />
      </div>
    </ScrollArea>
  )
}
