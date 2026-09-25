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
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { backfillLedger } from '../api'
import { QUERY_KEY_LEDGER, UNPRICED_BACKFILL_HINT_RATE } from '../constants'
import type { LedgerSummary } from '../types'

/**
 * Offers the historical backfill, but only when the numbers say it is needed.
 *
 * The margin columns were added after these logs were written, so rows older
 * than them read as unpriced until their JSON snapshot is denormalized. That
 * looks identical to "nobody configured a buy price" — which is why this is a
 * banner tied to the unpriced share rather than a permanent button: it appears
 * when the ledger is actually under-reporting, and goes away once it is not.
 *
 * Hidden below super-admin, matching the endpoint's RootAuth: it rewrites
 * historical accounting rows. Showing a button that 403s is worse than not
 * showing it.
 */
export function LedgerBackfillBanner(props: {
  summary: LedgerSummary | undefined
  windowStart: number
  windowEnd: number
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [isRunning, setIsRunning] = useState(false)
  const userRole = useAuthStore.getState().auth.user?.role ?? ROLE.GUEST
  const canBackfill = userRole >= ROLE.SUPER_ADMIN

  const unpricedRate = props.summary?.unpriced_rate
  if (
    !canBackfill ||
    unpricedRate == null ||
    unpricedRate < UNPRICED_BACKFILL_HINT_RATE
  ) {
    return null
  }

  const handleBackfill = async () => {
    setIsRunning(true)
    try {
      const result = await backfillLedger({
        startTimestamp: props.windowStart,
        endTimestamp: props.windowEnd,
      })
      // Scanned but nothing updated means these rows have no cost snapshot to
      // recover — they predate cost accounting entirely, or no buy price was
      // ever configured. Saying so beats a success toast that changes nothing.
      if (result.updated === 0) {
        toast.info(
          t(
            'Scanned {{scanned}} rows; none carried a recoverable cost. These requests were never priced.',
            { scanned: result.scanned }
          )
        )
      } else {
        toast.success(
          t('Backfilled {{updated}} of {{scanned}} rows', {
            updated: result.updated,
            scanned: result.scanned,
          })
        )
      }
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEY_LEDGER] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Backfill failed'))
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <Alert>
      <TriangleAlert aria-hidden='true' />
      <AlertDescription className='flex flex-wrap items-center justify-between gap-2'>
        <span>
          {t(
            '{{percent}}% of requests in this range have no recorded cost. Rows written before margin tracking keep their cost in the log payload — backfill moves it into the sortable columns.',
            { percent: Math.round(unpricedRate * 100) }
          )}
        </span>
        <Button
          variant='outline'
          size='sm'
          className='h-8 shrink-0'
          onClick={() => void handleBackfill()}
          disabled={isRunning}
        >
          {isRunning ? t('Backfilling...') : t('Backfill this range')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
