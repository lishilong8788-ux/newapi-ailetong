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
import { BadgeCheck, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'

import { AGENT_STATUSES, AGENT_TYPE_LABEL_KEYS } from '../constants'
import { formatCommissionRate, formatMaskedBankAccount } from '../lib/format'
import { useAgent } from './agent-provider'

function IdentityRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-2 text-xs'>
      <span className='text-muted-foreground shrink-0'>{props.label}</span>
      <div className='flex min-w-0 items-center justify-end'>
        {props.children}
      </div>
    </div>
  )
}

/**
 * The agent's identity record, plus the call to action that unblocks
 * withdrawing. A rejection is surfaced verbatim — without the reason the agent
 * has no way to know what to fix.
 */
export function IdentityCard() {
  const { t } = useTranslation()
  const { overview, isLoadingOverview, setOpen } = useAgent()

  if (isLoadingOverview && !overview) {
    return (
      <Card data-card-hover='false' className='py-0'>
        <CardContent className='space-y-3 p-4'>
          <Skeleton className='h-5 w-32' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-2/3' />
          <Skeleton className='h-9' />
        </CardContent>
      </Card>
    )
  }

  const profile = overview?.profile
  const status = profile?.status ?? 'incomplete'
  const statusConfig = AGENT_STATUSES[status]
  const isActive = status === 'active'
  const isRejected = status === 'rejected'
  const subjectName =
    profile?.agent_type === 'company'
      ? profile?.company_name
      : profile?.subject_name

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='space-y-3 p-4'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex min-w-0 items-center gap-2.5'>
            <IconBadge tone={isActive ? 'success' : 'warning'}>
              <BadgeCheck />
            </IconBadge>
            <h3 className='truncate text-sm font-semibold'>
              {t('Agent Identity')}
            </h3>
          </div>
          <StatusBadge
            label={t(statusConfig.labelKey)}
            variant={statusConfig.variant}
            copyable={false}
          />
        </div>

        <div className='space-y-2 border-t pt-3'>
          <IdentityRow label={t('Subject Type')}>
            <span className='font-medium'>
              {t(AGENT_TYPE_LABEL_KEYS[profile?.agent_type ?? 'personal'])}
            </span>
          </IdentityRow>
          {subjectName ? (
            <IdentityRow label={t('Subject Name')}>
              <span className='truncate font-medium'>{subjectName}</span>
            </IdentityRow>
          ) : null}
          <IdentityRow label={t('Commission Rate')}>
            <span className='font-medium tabular-nums'>
              {formatCommissionRate(profile?.commission_rate)}
            </span>
          </IdentityRow>
          {profile?.level ? (
            <IdentityRow label={t('Agent Level')}>
              <span className='truncate font-medium'>{profile.level}</span>
            </IdentityRow>
          ) : null}
          {profile?.bank_account ? (
            <IdentityRow label={t('Payout Account')}>
              <span className='truncate font-mono'>
                {formatMaskedBankAccount(profile.bank_account)}
              </span>
            </IdentityRow>
          ) : null}
        </div>

        {isRejected && profile?.reject_reason ? (
          <Alert variant='destructive'>
            <TriangleAlert aria-hidden='true' />
            <AlertTitle>{t('Review Rejected')}</AlertTitle>
            <AlertDescription>{profile.reject_reason}</AlertDescription>
          </Alert>
        ) : null}

        {!isActive && (
          <div className='bg-warning/10 text-warning space-y-2 rounded-lg p-3'>
            <p className='text-xs leading-relaxed'>
              {t(
                'Complete your identity details and wait for review before you can withdraw.'
              )}
            </p>
          </div>
        )}

        <Button
          variant={isActive ? 'outline' : 'default'}
          size='sm'
          className='w-full'
          onClick={() => setOpen('profile')}
        >
          {isActive ? t('Edit Details') : t('Complete Details')}
        </Button>
      </CardContent>
    </Card>
  )
}
