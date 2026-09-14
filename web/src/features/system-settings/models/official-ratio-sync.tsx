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
import { CloudDownload, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { formatTimestampToDate } from '@/lib/format'

import { syncOfficialRatios } from '../api'
import { useUpdateOption } from '../hooks/use-update-option'

export type OfficialRatioSyncProps = {
  autoSyncEnabled: boolean
  syncedAt: number
}

/**
 * Fetches vendor list prices so the model catalog can show "official price"
 * beside the platform price and label the gap as a discount.
 *
 * Two things worth stating plainly in the UI, because both are easy to assume
 * wrong: these prices never touch billing, and they are not what the platform
 * price is derived from. Operations set `ModelRatio` from cost plus margin; the
 * official price only decides what the discount label says.
 *
 * Auto-sync is off by default and opt-in here rather than on by default: the sync
 * makes outbound requests to public pricing endpoints, which an upgrade should
 * not start doing on its own.
 */
export function OfficialRatioSync(props: OfficialRatioSyncProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const updateOption = useUpdateOption()

  const syncMutation = useMutation({
    mutationFn: syncOfficialRatios,
    onSuccess: (data) => {
      if (!data.success || !data.data) {
        toast.error(data.message || t('Failed to sync official prices'))
        return
      }
      const failed = data.data.sources.filter((source) => source.error)
      if (failed.length > 0) {
        toast.warning(
          t('Some sources failed: {{errorMsg}}', {
            errorMsg: failed
              .map((source) => `${source.name}: ${source.error}`)
              .join(', '),
          })
        )
      }
      toast.success(
        t('Official prices synced for {{count}} models', {
          count: data.data.model_ratio_count,
        })
      )
      // The timestamp above this button lives in the options, and the prices
      // themselves are embedded in the pricing payload — which is cached for five
      // minutes. Without the second invalidation an admin who syncs and then opens
      // the model catalog in the same session sees the old official column and
      // concludes the sync did nothing.
      queryClient.invalidateQueries({ queryKey: ['system-options'] })
      queryClient.invalidateQueries({ queryKey: ['pricing'] })
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to sync official prices'))
    },
  })

  return (
    <div className='rounded-lg border p-4'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='min-w-0 space-y-1'>
          <h3 className='text-sm font-medium'>{t('Official price sync')}</h3>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Fetches vendor list prices so the model catalog can show them beside your platform price and label the difference as a discount. Display only — these values are never used for billing, and your own pricing ratios are left untouched.'
            )}
          </p>
          <p className='text-muted-foreground/70 text-xs'>
            {props.syncedAt > 0
              ? t('Last synced: {{time}}', {
                  time: formatTimestampToDate(props.syncedAt),
                })
              : t('Never synced')}
          </p>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? (
            <Loader2 className='size-4 animate-spin' />
          ) : (
            <CloudDownload className='size-4' />
          )}
          {syncMutation.isPending
            ? t('Syncing...')
            : t('Sync official prices now')}
        </Button>
      </div>

      <div className='mt-4 flex items-center justify-between gap-4 border-t pt-4'>
        <div className='min-w-0'>
          <div className='text-sm font-medium'>{t('Daily auto sync')}</div>
          <p className='text-muted-foreground text-xs'>
            {t('Refresh official prices once a day in the background.')}
          </p>
        </div>
        <Switch
          checked={props.autoSyncEnabled}
          disabled={updateOption.isPending}
          onCheckedChange={(checked) =>
            updateOption.mutate({
              key: 'OfficialRatioAutoSyncEnabled',
              value: String(checked),
            })
          }
        />
      </div>
    </div>
  )
}
