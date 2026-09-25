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
import {
  createFileRoute,
  redirect,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Copilot } from '@/features/copilot'
import { ROLE } from '@/lib/roles'
import { getHttpStatus } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/copilot/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()

    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({
        to: '/403',
      })
    }
  },
  component: Copilot,
  errorComponent: CopilotError,
})

/**
 * Contains a crash on this page to this page.
 *
 * Without a route-level boundary the nearest one is the root's, so any throw from
 * the copilot view unmounts the whole admin shell in favour of a full-screen error
 * page — no nav, no way out but the browser's back button. That is a bad trade for
 * a page whose content is a live stream of model output: this is exactly where an
 * unexpected payload shape surfaces first. Here the chrome survives and the reader
 * can retry or leave.
 */
function CopilotError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation()
  const status = getHttpStatus(error)

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[copilot] render failed', error)
  }, [error])

  return (
    <div className='p-4 sm:p-6'>
      <Alert variant='destructive'>
        <TriangleAlert aria-hidden='true' />
        <AlertTitle>
          {status === 429
            ? t('Too many requests')
            : t('Failed to load the ops copilot')}
        </AlertTitle>
        <AlertDescription>
          <p>
            {status === 429
              ? t('Please wait a moment before trying again.')
              : (error instanceof Error && error.message) ||
                t('Please try again later.')}
          </p>
          <Button variant='outline' size='sm' onClick={reset}>
            {t('Retry')}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
