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
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { recalculateCostDaily } from '../api'
import {
  QUERY_KEY_COST_CHANNELS,
  QUERY_KEY_COST_CHANNEL_MODELS,
  QUERY_KEY_COST_OVERVIEW,
  QUERY_KEY_COST_TREND,
} from '../constants'
import { formatDayLabel } from '../lib'

/**
 * Rebuilds the visible window's daily rollup from the `logs` detail.
 *
 * Exists because the rollup and the log detail can disagree, and when they do
 * the rollup is the wrong one: it is an aggregate maintained by a flush loop,
 * so a defect in that loop (or a cost price corrected after the fact) is only
 * repairable by recomputing from the logs. The confirmation is not ceremony —
 * the rebuild deletes the window's rows before rewriting them, recomputes with
 * *today's* cost configuration rather than the price in force at the time, and
 * rebuilds to zero for any day whose logs have already aged out.
 *
 * Hidden below super-admin to match the endpoint's RootAuth; a button that
 * 403s is worse than no button.
 */
export function RecalculateButton(props: {
  windowStart: number
  windowEnd: number
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const userRole = useAuthStore((state) => state.auth.user?.role ?? ROLE.GUEST)

  if (userRole < ROLE.SUPER_ADMIN) return null

  const handleConfirm = async () => {
    setIsRunning(true)
    try {
      const result = await recalculateCostDaily({
        start_timestamp: props.windowStart,
        end_timestamp: props.windowEnd,
      })
      toast.success(result.message)
      await Promise.all(
        [
          QUERY_KEY_COST_OVERVIEW,
          QUERY_KEY_COST_TREND,
          QUERY_KEY_COST_CHANNELS,
          QUERY_KEY_COST_CHANNEL_MODELS,
        ].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))
      )
      setIsOpen(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Recalculation failed')
      )
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <>
      <Button
        variant='outline'
        size='sm'
        className='h-8 gap-1.5 px-2.5 text-xs font-normal'
        onClick={() => setIsOpen(true)}
      >
        <RefreshCw className='h-3.5 w-3.5 opacity-60' aria-hidden='true' />
        {t('Rebuild from logs')}
      </Button>
      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Rebuild from logs')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Discards the stored daily totals for {{from}} to {{to}} and recomputes them from the request logs. Use this when the totals look inflated or a buy price was corrected after the fact. Two caveats: the rebuild prices every request with the current cost configuration, not the price in force at the time, and any day whose logs have already been deleted rebuilds to zero.',
                {
                  from: formatDayLabel(props.windowStart),
                  to: formatDayLabel(props.windowEnd),
                }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRunning}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog mounted while the request is in flight: the
                // default action closes it, which would unmount the pending
                // state and lose both the spinner and the result toast.
                event.preventDefault()
                void handleConfirm()
              }}
              disabled={isRunning}
            >
              {isRunning ? t('Rebuilding...') : t('Rebuild')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
