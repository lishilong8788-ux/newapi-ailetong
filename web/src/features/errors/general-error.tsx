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
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { getHttpStatus } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

const FEEDBACK_URL = 'https://github.com/QuantumNous/new-api/issues'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
  error?: unknown
  /** Explicit status, for callers that know it without holding the error. */
  status?: number
}

export function GeneralError({
  className,
  minimal = false,
  error,
  status: statusOverride,
}: GeneralErrorProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { history } = useRouter()
  const status = statusOverride ?? getHttpStatus(error)
  const isRateLimited = status === 429

  const title = isRateLimited
    ? t('Too many requests')
    : `${t('Oops! Something went wrong')} ${`:')`}`
  const description = isRateLimited
    ? t('Please wait a moment before trying again.')
    : t('Please try again later.')

  // The page renders a number, which is all the user needs and nowhere near
  // enough to debug with: a render-time exception carries no status at all and
  // used to be indistinguishable from a real 500. Log the thrown value so the
  // stack survives in the console of whoever hit it.
  useEffect(() => {
    if (error === undefined) return
    // eslint-disable-next-line no-console
    console.error('[error-page] unhandled error', { status, error })
  }, [error, status])

  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        {!minimal && (
          <h1 className='text-[7rem] leading-tight font-bold'>
            {status ?? 500}
          </h1>
        )}
        <span className='font-medium'>{title}</span>
        <p className='text-muted-foreground text-center'>
          {t('We apologize for the inconvenience.')} <br /> {description}
        </p>
        {!minimal && (
          <p className='text-muted-foreground text-center text-sm'>
            {t('If this keeps happening, please report it on GitHub Issues.')}
          </p>
        )}
        {!minimal && (
          <div className='mt-6 flex flex-wrap justify-center gap-4'>
            <Button variant='outline' onClick={() => history.go(-1)}>
              {t('Go Back')}
            </Button>
            <Button
              variant='outline'
              render={
                <a
                  href={FEEDBACK_URL}
                  target='_blank'
                  rel='noopener noreferrer'
                />
              }
            >
              {t('Report an issue')}
            </Button>
            <Button onClick={() => navigate({ to: '/' })}>
              {t('Back to Home')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
