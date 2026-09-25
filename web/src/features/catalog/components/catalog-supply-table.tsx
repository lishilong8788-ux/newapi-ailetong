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
/**
 * The supply side for one model, editable in place.
 *
 * Every channel whose model list contains the model gets a row — serving or not.
 * `/api/pricing/channels` only knows the serving ones, and the rows it omits are
 * exactly the ones an operator opened this page to fix, so the list is built from
 * raw channel config and the route is joined on where it exists.
 *
 * What a row can edit is deliberately split. The buy price is per
 * (channel, model) and gets its own dialog. Priority, weight, groups and the key
 * are channel-wide, so editing them goes through the full channel drawer rather
 * than an inline control that would silently retune every other model on the
 * line.
 */
import { Pencil, Plus, Server, Trash2, Wallet, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { parseGroups } from '@/features/channels/lib'
import { formatLatency } from '@/features/performance-metrics/lib/format'
import type { AutoRouteInfo } from '@/features/pricing/types'
import { cn } from '@/lib/utils'

import type { CatalogSupplyRow } from '../types'
import { SupplyPriceCell } from './supply-price-cell'

export type CatalogSupplyTableProps = {
  modelName: string
  rows: CatalogSupplyRow[]
  autoRoute?: AutoRouteInfo
  isLoading: boolean
  /** True when the viewer may write channel settings, which cost lives inside. */
  canEditCost: boolean
  onAttach: () => void
  onCreateChannel: () => void
  onEditChannel: (row: CatalogSupplyRow) => void
  onEditCost: (row: CatalogSupplyRow) => void
  onDetach: (row: CatalogSupplyRow) => void
  detachingChannelId?: number
}

export function CatalogSupplyTable(props: CatalogSupplyTableProps) {
  const { t } = useTranslation()
  const servingCount = props.rows.filter((row) => row.serving).length
  const idleCount = props.rows.length - servingCount

  return (
    <section className='bg-card rounded-xl border'>
      <header className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          <h3 className='text-sm font-semibold'>{t('Supply')}</h3>
          <span className='text-muted-foreground text-[13px]'>
            {t('{{count}} lines serving', { count: servingCount })}
            {idleCount > 0 &&
              ` · ${t('{{count}} configured but idle', { count: idleCount })}`}
          </span>
          {props.autoRoute?.enabled && (
            <Badge variant='outline' className='gap-1 text-[13px]'>
              <Zap className='size-3.5' aria-hidden='true' />
              {props.autoRoute.ranked
                ? t('Lowest-price routing')
                : t('Lowest-price routing (no price spread)')}
            </Badge>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Button variant='outline' size='xs' onClick={props.onAttach}>
            <Plus />
            {t('Add channel')}
          </Button>
          <Button variant='outline' size='xs' onClick={props.onCreateChannel}>
            <Server />
            {t('New channel')}
          </Button>
        </div>
      </header>

      {props.isLoading && (
        <div className='space-y-2 p-4'>
          <Skeleton className='h-8 w-full' />
          <Skeleton className='h-8 w-full' />
        </div>
      )}

      {!props.isLoading && props.rows.length === 0 && (
        <Empty className='border-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Server aria-hidden='true' />
            </EmptyMedia>
            <EmptyTitle>{t('No channel carries this model')}</EmptyTitle>
            <EmptyDescription>
              {t(
                'Add it to a channel you already have, or create a channel for it. Nothing is sellable until one line serves it.'
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className='flex flex-wrap justify-center gap-2'>
              <Button size='sm' onClick={props.onAttach}>
                <Plus />
                {t('Add channel')}
              </Button>
              <Button size='sm' variant='outline' onClick={props.onCreateChannel}>
                <Server />
                {t('New channel')}
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      )}

      {!props.isLoading && props.rows.length > 0 && (
        <div className='overflow-x-auto'>
          <table className='w-full text-[13px]'>
            <thead>
              <tr className='text-muted-foreground text-[13px]'>
                <th scope='col' className='px-4 py-2 text-left font-medium'>
                  {t('Line')}
                </th>
                <th scope='col' className='px-4 py-2 text-left font-medium'>
                  {t('Upstream model')}
                </th>
                <th scope='col' className='px-4 py-2 text-right font-medium'>
                  {t('Buy')}
                </th>
                <th scope='col' className='px-4 py-2 text-right font-medium'>
                  {t('Sell')}
                </th>
                <th scope='col' className='px-4 py-2 text-right font-medium'>
                  {t('Margin')}
                </th>
                <th scope='col' className='px-4 py-2 text-right font-medium'>
                  {t('Latency')}
                </th>
                <th scope='col' className='px-4 py-2 text-right font-medium'>
                  <span className='sr-only'>{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <SupplyRow
                  key={row.channel.id}
                  row={row}
                  modelName={props.modelName}
                  canEditCost={props.canEditCost}
                  onEditChannel={() => props.onEditChannel(row)}
                  onEditCost={() => props.onEditCost(row)}
                  onDetach={() => props.onDetach(row)}
                  isDetaching={props.detachingChannelId === row.channel.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className='text-muted-foreground border-t px-4 py-2 text-[13px] leading-relaxed'>
        {t(
          'Each channel bills its own buy price plus markup. Channels without one fall back to the platform price above.'
        )}
      </p>
    </section>
  )
}

function SupplyRow(props: {
  row: CatalogSupplyRow
  modelName: string
  canEditCost: boolean
  onEditChannel: () => void
  onEditCost: () => void
  onDetach: () => void
  isDetaching: boolean
}) {
  const { t } = useTranslation()
  const { channel, route } = props.row
  const groups = parseGroups(channel.group ?? '')
  const label = channel.line_code || channel.name || `#${channel.id}`

  return (
    <tr className={cn('border-t', !props.row.serving && 'bg-muted/25')}>
      <td className='px-4 py-2'>
        <div className='flex min-w-0 flex-col gap-1'>
          <button
            type='button'
            onClick={props.onEditChannel}
            className='text-left font-mono text-[13px] font-medium wrap-anywhere hover:underline'
          >
            {label}
          </button>
          <div className='flex flex-wrap items-center gap-1'>
            {!props.row.serving && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge
                      variant='outline'
                      className='cursor-help px-1.5 py-0 text-[13px] font-normal'
                    />
                  }
                >
                  {t('Idle')}
                </TooltipTrigger>
                <TooltipContent className='max-w-64'>
                  {t(
                    'This channel lists the model but does not serve it — it is disabled, or the model has no live ability row.'
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {groups.slice(0, 3).map((group) => (
              <GroupBadge key={group} group={group} size='sm' />
            ))}
            {groups.length > 3 && (
              <span className='text-muted-foreground text-[13px] tabular-nums'>
                +{groups.length - 3}
              </span>
            )}
          </div>
        </div>
      </td>

      <td className='text-muted-foreground px-4 py-2 font-mono text-[13px]'>
        <span className='block wrap-anywhere'>{props.row.upstreamModel}</span>
        {props.row.upstreamModel !== props.modelName && (
          <span className='text-muted-foreground/70 text-[13px]'>{t('mapped')}</span>
        )}
      </td>

      <SupplyPriceCell row={props.row} column='buy' />
      <SupplyPriceCell row={props.row} column='sell' />
      <SupplyPriceCell row={props.row} column='margin' />

      <td className='px-4 py-2 text-right text-[13px] tabular-nums'>
        {route?.latency_ms ? (
          formatLatency(route.latency_ms)
        ) : (
          <span className='text-muted-foreground'>-</span>
        )}
      </td>

      <td className='px-4 py-2'>
        <div className='flex items-center justify-end gap-0.5'>
          {props.canEditCost && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-8'
                    aria-label={t('Set buy price')}
                    onClick={props.onEditCost}
                  />
                }
              >
                <Wallet className='size-4' aria-hidden='true' />
              </TooltipTrigger>
              <TooltipContent>{t('Set buy price')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-8'
                  aria-label={t('Edit channel')}
                  onClick={props.onEditChannel}
                />
              }
            >
              <Pencil className='size-4' aria-hidden='true' />
            </TooltipTrigger>
            <TooltipContent>{t('Edit channel')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground hover:text-destructive size-8'
                  aria-label={t('Remove from this channel')}
                  disabled={props.isDetaching}
                  onClick={props.onDetach}
                />
              }
            >
              <Trash2 className='size-4' aria-hidden='true' />
            </TooltipTrigger>
            <TooltipContent>{t('Remove from this channel')}</TooltipContent>
          </Tooltip>
        </div>
      </td>
    </tr>
  )
}
