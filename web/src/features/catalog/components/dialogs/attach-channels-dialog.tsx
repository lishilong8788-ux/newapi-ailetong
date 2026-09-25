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
import { Loader2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { updateChannel } from '@/features/channels/api'
import { channelsQueryKeys } from '@/features/channels/lib'
import type { Channel } from '@/features/channels/types'
import { cn } from '@/lib/utils'

import { buildChannelModelList, findAttachableChannels, isChannelEnabled } from '../../lib'

export type AttachChannelsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelName: string
  channels: readonly Channel[]
}

/**
 * Put one model on more channels.
 *
 * Only the model list is written — `{id, models}` and nothing else. That keeps
 * the request out of the sensitive-field path (a channel's key, base URL and
 * settings are untouched), so an admin with plain channel write can extend
 * supply without holding sensitive-write. Each channel is a separate request
 * because the model list is a read-modify-write on one column: a batch endpoint
 * that took a single list would have to guess the per-channel result.
 */
export function AttachChannelsDialog(props: AttachChannelsDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const candidates = useMemo(
    () => findAttachableChannels(props.modelName, props.channels),
    [props.modelName, props.channels]
  )

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return candidates
    return candidates.filter(
      (channel) =>
        channel.name.toLowerCase().includes(needle) ||
        (channel.line_code ?? '').toLowerCase().includes(needle)
    )
  }, [candidates, search])

  const attach = useMutation({
    mutationFn: async (ids: number[]) => {
      const targets = candidates.filter((channel) => ids.includes(channel.id))
      let attached = 0
      const failures: string[] = []

      for (const channel of targets) {
        const models = buildChannelModelList(channel, props.modelName, 'attach')
        if (models == null) continue
        try {
          const response = await updateChannel(channel.id, { models })
          if (!response.success) {
            failures.push(response.message || channel.name)
            continue
          }
          attached += 1
        } catch (error) {
          failures.push(error instanceof Error ? error.message : channel.name)
        }
      }

      return { attached, failures }
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: channelsQueryKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['pricing'] })
      void queryClient.invalidateQueries({ queryKey: ['pricing-channels'] })

      if (result.attached > 0) {
        toast.success(
          t('Added to {{count}} channel(s)', { count: result.attached })
        )
      }
      // Partial failure is reported alongside the success rather than instead of
      // it: some channels did take the model, and a bare error would send the
      // operator back to re-add every one of them.
      if (result.failures.length > 0) {
        toast.error(
          t('{{count}} channel(s) could not be updated', {
            count: result.failures.length,
          })
        )
        return
      }
      handleOpenChange(false)
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : t('Failed to update channels')
      )
    },
  })

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSearch('')
      setSelectedIds([])
    }
    props.onOpenChange(open)
  }

  const toggle = (id: number) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title={t('Add this model to channels')}
      description={
        <span className='font-mono text-[13px]'>{props.modelName}</span>
      }
      contentClassName='sm:max-w-lg'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => handleOpenChange(false)}
            disabled={attach.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => attach.mutate(selectedIds)}
            disabled={selectedIds.length === 0 || attach.isPending}
          >
            {attach.isPending && <Loader2 className='animate-spin' />}
            {t('Add to {{count}} channel(s)', { count: selectedIds.length })}
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className='text-muted-foreground py-6 text-center text-[13px]'>
          {t('Every channel already lists this model.')}
        </p>
      ) : (
        <div className='space-y-3'>
          <div className='relative'>
            <Search
              className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2'
              aria-hidden='true'
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Search channels...')}
              aria-label={t('Search channels...')}
              className='h-8 pl-8 text-[13px]'
            />
          </div>

          <ScrollArea className='max-h-72'>
            <div className='space-y-1 pr-1'>
              {visible.map((channel) => {
                const inputId = `attach-channel-${channel.id}`
                const enabled = isChannelEnabled(channel)
                return (
                  <Label
                    key={channel.id}
                    htmlFor={inputId}
                    className={cn(
                      'hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2',
                      selectedIds.includes(channel.id) &&
                        'border-primary/45 bg-accent'
                    )}
                  >
                    <Checkbox
                      id={inputId}
                      checked={selectedIds.includes(channel.id)}
                      onCheckedChange={() => toggle(channel.id)}
                      disabled={attach.isPending}
                    />
                    <span className='min-w-0 flex-1'>
                      <span className='block wrap-anywhere text-[13px] font-medium'>
                        {channel.name}
                      </span>
                      <span className='text-muted-foreground block wrap-anywhere text-[13px]'>
                        {channel.line_code
                          ? `${channel.line_code} · #${channel.id}`
                          : `#${channel.id}`}
                      </span>
                    </span>
                    {!enabled && (
                      <Badge variant='outline' className='shrink-0 text-[13px]'>
                        {t('Disabled')}
                      </Badge>
                    )}
                  </Label>
                )
              })}

              {visible.length === 0 && (
                <p className='text-muted-foreground py-6 text-center text-[13px]'>
                  {t('No channels match your search.')}
                </p>
              )}
            </div>
          </ScrollArea>

          <p className='text-muted-foreground text-[13px]'>
            {t(
              'Only the model list changes. Set what you pay for it per channel afterwards.'
            )}
          </p>
        </div>
      )}
    </Dialog>
  )
}
