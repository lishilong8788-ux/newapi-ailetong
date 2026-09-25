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
 * What one channel costs for one model, edited where the operator found it.
 *
 * The channel drawer's pricing tab does the same job for a whole channel; this
 * dialog is the single-cell version of it, reached from the supply row. It
 * deliberately reuses the drawer's form schema, its transform and its save
 * mutation rather than writing the `cost` object itself: the stored shape has
 * eleven price kinds, two markup levels and a raw-JSON escape hatch, and a second
 * writer would drift from it.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { getChannel } from '@/features/channels/api'
import { useChannelMutateForm } from '@/features/channels/hooks/use-channel-mutate-form'
import {
  channelFormSchema,
  channelsQueryKeys,
  transformChannelToFormDefaults,
  type ChannelFormValues,
} from '@/features/channels/lib'
import type { Channel } from '@/features/channels/types'
import { getPricing } from '@/features/pricing/api'
import {
  getTokenUnitPrice,
  toOfficiallyPricedModel,
} from '@/features/pricing/lib/price'

import { ChannelCostPanel } from './channel-cost-panel'

export type ChannelCostDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel: Channel
  /** Client-facing name, shown as the heading. */
  modelName: string
  /** Name this channel requests upstream — the key the cost is stored under. */
  upstreamModel: string
}

export function ChannelCostDialog(props: ChannelCostDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // The index of the row being edited. Set once the channel loads, because the
  // row may have to be appended first.
  const [rowIndex, setRowIndex] = useState<number | null>(null)

  const { data: channelData, isLoading } = useQuery({
    queryKey: channelsQueryKeys.detail(props.channel.id),
    queryFn: () => getChannel(props.channel.id),
    enabled: props.open,
  })

  const { data: pricingData, isLoading: isLoadingPricing } = useQuery({
    queryKey: ['pricing'],
    queryFn: getPricing,
    staleTime: 5 * 60 * 1000,
    enabled: props.open,
  })

  const form = useForm<ChannelFormValues>({
    resolver: zodResolver(channelFormSchema),
  })

  // Vendor list price for the upstream name, in USD / 1M tokens — the same unit
  // the buy-price boxes take, so a copied vendor figure needs no conversion.
  const officialPrice = useMemo(() => {
    const model = (pricingData?.data ?? []).find(
      (entry) => entry.model_name === props.upstreamModel
    )
    if (!model) return undefined
    const official = toOfficiallyPricedModel(model)
    if (!official) return undefined
    return {
      input: getTokenUnitPrice(official, 'input', 'M', false, 1, 1, 1),
      output: getTokenUnitPrice(official, 'output', 'M', false, 1, 1, 1),
      cacheRead: getTokenUnitPrice(official, 'cache', 'M', false, 1, 1, 1),
    }
  }, [pricingData, props.upstreamModel])

  // Load the channel into the form, then make sure the model has a row to edit.
  // Appending here rather than on first keystroke keeps the panel's field paths
  // valid from the first render: every input is bound to `cost_models.<i>.<kind>`.
  useEffect(() => {
    if (!props.open || !channelData?.data) return
    const defaults = transformChannelToFormDefaults(channelData.data)
    const existing = (defaults.cost_models ?? []).findIndex(
      (row) => row.model?.trim() === props.upstreamModel
    )
    const costModels =
      existing >= 0
        ? defaults.cost_models
        : [...(defaults.cost_models ?? []), { model: props.upstreamModel }]

    form.reset({ ...defaults, cost_models: costModels })
    setRowIndex(existing >= 0 ? existing : (costModels?.length ?? 1) - 1)
  }, [props.open, channelData, props.upstreamModel, form])

  const mutation = useChannelMutateForm({
    currentRow: channelData?.data ?? props.channel,
    isEditing: true,
    isMultiKeyChannel: Boolean(
      channelData?.data?.channel_info?.is_multi_key ??
        props.channel.channel_info?.is_multi_key
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelsQueryKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['pricing'] })
      void queryClient.invalidateQueries({ queryKey: ['pricing-channels'] })
      props.onOpenChange(false)
    },
  })

  const isBusy = mutation.isPending
  const ready = !isLoading && rowIndex != null

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !isBusy && props.onOpenChange(open)}
      title={t('Buy price on this channel')}
      description={
        <span className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]'>
          <span className='font-medium'>{props.channel.name}</span>
          <span className='text-muted-foreground font-mono'>
            {props.upstreamModel}
          </span>
          {props.upstreamModel !== props.modelName && (
            <span className='text-muted-foreground'>
              {t('mapped from {{model}}', { model: props.modelName })}
            </span>
          )}
        </span>
      }
      contentClassName='sm:max-w-xl'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={isBusy}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => void form.handleSubmit((values) => mutation.mutate(values))()}
            disabled={!ready || isBusy}
          >
            {isBusy && <Loader2 className='animate-spin' />}
            {t('Save')}
          </Button>
        </>
      }
    >
      {ready ? (
        <Form {...form}>
          <ChannelCostPanel
            form={form}
            index={rowIndex}
            officialPrice={officialPrice}
            isLoadingOfficialPrice={isLoadingPricing}
          />
        </Form>
      ) : (
        <div className='space-y-2 py-2'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-40 w-full' />
        </div>
      )}
    </Dialog>
  )
}
