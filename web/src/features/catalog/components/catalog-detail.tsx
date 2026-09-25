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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, FilePlus2, Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { GroupBadge } from '@/components/group-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { updateChannel } from '@/features/channels/api'
import { channelsQueryKeys } from '@/features/channels/lib'
import type { Channel } from '@/features/channels/types'
import { useChannelPricing } from '@/features/pricing/hooks'
import { getLobeIcon } from '@/lib/lobe-icon'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { useAuthStore } from '@/stores/auth-store'

import { buildChannelModelList, buildSupplyRows } from '../lib'
import { CATALOG_STATUS_META } from '../lib/catalog-status'
import type { CatalogItem, CatalogSupplyRow } from '../types'
import { CatalogPriceSummary } from './catalog-price-summary'
import { useCatalogEditor } from './catalog-provider'
import { CatalogStatusDot } from './catalog-status-dot'
import { CatalogSupplyTable } from './catalog-supply-table'

export interface CatalogDetailProps {
  item: CatalogItem
  /** Every channel on the install, for the supply join. */
  channels: readonly Channel[]
  groupRatio: Record<string, number>
  priceRate: number
  usdExchangeRate: number
  className?: string
}

/**
 * One product: what state it is in, what it sells for, and who supplies it.
 *
 * Laid out in the order an operator asks the questions — is it sellable, is the
 * price right, is there supply — and every answer is editable from where it is
 * read. The page used to link out to the models page, the billing settings and
 * the channels page for those three; the round trip is the thing this layout
 * exists to remove.
 */
export function CatalogDetail(props: CatalogDetailProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { openEditor } = useCatalogEditor()
  const { item } = props
  const { routes, autoRoute, isLoading } = useChannelPricing(item.modelName)
  const statusMeta = CATALOG_STATUS_META[item.status]

  const currentUser = useAuthStore((state) => state.auth.user)
  // A channel's buy price is stored inside `settings`, which the backend
  // classifies as a sensitive field. Hiding the action for an admin who cannot
  // write it is kinder than letting them fill in a sheet the server will reject.
  const canEditCost = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.CHANNEL,
    ADMIN_PERMISSION_ACTIONS.SENSITIVE_WRITE
  )

  const supplyRows = useMemo(
    () => buildSupplyRows(item.modelName, props.channels, routes),
    [item.modelName, props.channels, routes]
  )

  // Detaching is confirmed rather than immediate: removing the last serving line
  // takes the product out of stock, and the row that did it looks the same as the
  // three beside it. Re-attaching is one click, so the dialog only has to make the
  // consequence visible, not guard against it.
  const [pendingDetach, setPendingDetach] = useState<CatalogSupplyRow | null>(
    null
  )

  const detach = useMutation({
    mutationFn: async (row: CatalogSupplyRow) => {
      const models = buildChannelModelList(
        row.channel,
        item.modelName,
        'detach'
      )
      if (models == null) return
      const response = await updateChannel(row.channel.id, { models })
      if (!response.success) {
        throw new Error(response.message || t('Failed to update channels'))
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelsQueryKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['pricing'] })
      void queryClient.invalidateQueries({ queryKey: ['pricing-channels'] })
      toast.success(t('Removed from the channel'))
      setPendingDetach(null)
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : t('Failed to update channels')
      )
    },
  })

  // Only counts against *serving* lines: detaching an idle one changes nothing an
  // operator can observe, and warning about it would train them past the warning
  // that matters.
  const lastServingLine =
    pendingDetach?.serving === true &&
    supplyRows.filter((row) => row.serving).length === 1

  const tags = (item.pricing?.tags ?? item.model?.tags ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

  const icon = item.pricing?.icon || item.model?.icon || item.vendorIcon
  const description = item.pricing?.description || item.model?.description

  return (
    <ScrollArea className={props.className}>
      <div className='space-y-4 pr-1'>
        <header className='bg-card rounded-xl border p-4'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0 space-y-1.5'>
              <div className='flex min-w-0 items-center gap-2'>
                {icon && <span className='shrink-0'>{getLobeIcon(icon, 20)}</span>}
                {/* Same rule as the rail: the name reads in full or the page is
                    lying about which model is on screen. */}
                <h2 className='min-w-0 font-mono text-[17px] font-bold wrap-anywhere'>
                  {item.modelName}
                </h2>
                <span className='flex shrink-0 items-center gap-1.5'>
                  <CatalogStatusDot status={item.status} />
                  <span className={`text-[13px] font-medium ${statusMeta.textClass}`}>
                    {t(statusMeta.labelKey)}
                  </span>
                </span>
              </div>
              <p className='text-muted-foreground text-[13px] leading-relaxed'>
                {item.vendorName}
                {description ? ` · ${description}` : ''}
              </p>
              {tags.length > 0 && (
                <div className='flex flex-wrap gap-1 pt-0.5'>
                  {tags.map((tag) => (
                    <Badge key={tag} variant='secondary' className='text-[13px]'>
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* A name that reaches the relay without a metadata row is normal and
                works, but it has no vendor, description or tags — so the action is
                "create the row", not "edit" something that is not there. */}
            {item.model ? (
              <Button
                variant='outline'
                size='xs'
                onClick={() => {
                  if (!item.model) return
                  openEditor({ kind: 'edit-model', model: item.model })
                }}
              >
                <Pencil />
                {t('Edit product')}
              </Button>
            ) : (
              <Button
                variant='outline'
                size='xs'
                onClick={() =>
                  openEditor({
                    kind: 'create-model',
                    modelName: item.modelName,
                  })
                }
              >
                <FilePlus2 />
                {t('Create product profile')}
              </Button>
            )}
          </div>

          {/* The state description doubles as the fix instruction for every state
              that needs one, so it is spelled out here rather than hidden in the
              left rail's tooltip. */}
          {item.status !== 'on_sale' && (
            <p className='text-muted-foreground mt-3 border-t pt-3 text-[13px] leading-relaxed'>
              {t(statusMeta.descriptionKey)}
            </p>
          )}

          {item.pricing && (
            <div className='mt-3 flex flex-wrap items-center gap-2 border-t pt-3'>
              <span className='text-muted-foreground inline-flex items-center gap-1 text-[13px]'>
                <Boxes className='size-3.5' aria-hidden='true' />
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

        <CatalogPriceSummary
          item={item}
          priceRate={props.priceRate}
          usdExchangeRate={props.usdExchangeRate}
        />

        <CatalogSupplyTable
          modelName={item.modelName}
          rows={supplyRows}
          autoRoute={autoRoute}
          isLoading={isLoading}
          canEditCost={canEditCost}
          onAttach={() =>
            openEditor({ kind: 'attach-channels', modelName: item.modelName })
          }
          onCreateChannel={() =>
            openEditor({ kind: 'create-channel', modelName: item.modelName })
          }
          onEditChannel={(row) =>
            openEditor({ kind: 'edit-channel', channel: row.channel })
          }
          onEditCost={(row) =>
            openEditor({
              kind: 'channel-cost',
              channel: row.channel,
              modelName: item.modelName,
              upstreamModel: row.upstreamModel,
            })
          }
          onDetach={(row) => setPendingDetach(row)}
          detachingChannelId={
            detach.isPending ? detach.variables?.channel.id : undefined
          }
        />
      </div>

      <ConfirmDialog
        open={pendingDetach != null}
        onOpenChange={(open) => !open && setPendingDetach(null)}
        title={t('Remove from this channel')}
        destructive
        isLoading={detach.isPending}
        confirmText={t('Remove')}
        handleConfirm={() => pendingDetach && detach.mutate(pendingDetach)}
        desc={
          <div className='space-y-2 text-[13px]'>
            <p>
              {t(
                'Stop serving {{model}} from {{channel}}? The channel keeps its other models.',
                {
                  model: item.modelName,
                  channel: pendingDetach?.channel.name ?? '',
                }
              )}
            </p>
            {lastServingLine && (
              <p className='text-warning'>
                {t(
                  'This is the only line serving it, so the product goes out of stock.'
                )}
              </p>
            )}
          </div>
        }
      />
    </ScrollArea>
  )
}
