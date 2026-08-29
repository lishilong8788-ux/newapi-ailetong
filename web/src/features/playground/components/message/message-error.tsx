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
import { AlertCircle, AlertTriangle, Settings } from 'lucide-react'
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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import {
  FALLBACK_ERROR_CONTENT,
  getMessageErrorState,
  isAdminRole,
  MODEL_PRICING_SETTINGS_PATH,
} from '../../lib'
import type { Message } from '../../types'

interface MessageErrorProps {
  message: Message
  className?: string
  actions?: ReactNode
}

/**
 * Display error messages using Alert component
 * Following ai-elements pattern for error handling
 */
export function MessageError({
  message,
  className = '',
  actions,
}: MessageErrorProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.auth.user)
  const errorState = getMessageErrorState(message, isAdminRole(user?.role))

  if (!errorState) {
    return null
  }

  if (errorState.kind === 'model-price') {
    /*
     * The backend text is deliberately dropped here.
     *
     * `relay/helper/price.go` returns Chinese and English concatenated in one
     * string, with different wording for admins, and the transport appends a
     * request id. Printed under a title that already says "no price set", that
     * came out as five lines saying one thing twice in two languages — the
     * screenshot that prompted this read as a stack trace.
     *
     * Classification does not depend on that prose: `errorCode` is
     * `MODEL_PRICE_ERROR_CODE`, checked in `getMessageErrorState`, so the
     * condition is known exactly and the sentence can be written for the
     * reader instead of forwarded. i18n then picks the user's language rather
     * than showing both.
     *
     * No request id in this branch either. It identifies one request, and the
     * cause is configuration — the id is only noise on the way to Settings.
     */
    return (
      <Alert variant='default' className={className}>
        <AlertTriangle className='text-orange-500' />
        <AlertTitle>{t('This model has no price set')}</AlertTitle>
        <AlertDescription className='space-y-2'>
          <p>
            {errorState.showSettingsLink
              ? t(
                  'Requests are rejected until a price is configured for this model.'
                )
              : t(
                  'It cannot be used until an administrator configures its price.'
                )}
          </p>
          {errorState.showSettingsLink && (
            <Button
              variant='outline'
              size='sm'
              onClick={() => window.open(MODEL_PRICING_SETTINGS_PATH, '_blank')}
            >
              <Settings className='mr-1 h-3.5 w-3.5' />
              {t('Go to Settings')}
            </Button>
          )}
          {actions}
        </AlertDescription>
      </Alert>
    )
  }

  /*
   * Mapped codes get a written title and sentence, with the relay's own text
   * kept below in a muted line.
   *
   * The raw text is not dropped the way the price branch drops it: for a missing
   * channel or a rejected key it names the model and carries the request id,
   * which is what an administrator needs in order to find the request in the
   * logs. It is demoted rather than deleted.
   */
  if (errorState.explanation) {
    return (
      <Alert variant='destructive' className={className}>
        <AlertCircle />
        <AlertTitle>{t(errorState.explanation.title)}</AlertTitle>
        <AlertDescription className='space-y-2'>
          <p>{t(errorState.explanation.body)}</p>
          <p className='text-muted-foreground/80 text-[11px] leading-relaxed break-all'>
            {errorState.content}
          </p>
          {actions}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant='destructive' className={className}>
      <AlertCircle />
      <AlertTitle>{t('Error')}</AlertTitle>
      <AlertDescription className='space-y-2'>
        <p>
          {errorState.content === FALLBACK_ERROR_CONTENT
            ? t(FALLBACK_ERROR_CONTENT)
            : errorState.content}
        </p>
        {actions}
      </AlertDescription>
    </Alert>
  )
}
