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
import { Handshake, Info, Percent, Timer, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'

import { AGENT_STATUSES, WITHDRAWAL_DEFAULTS } from '../constants'
import { formatAgentCurrency, formatCommissionRate } from '../lib/format'
import type { AgentProfile } from '../types'
import { useAgent } from './agent-provider'

const HEADING_ID = 'agent-application-heading'

/** Which of the four pre-promotion screens this profile is on. */
type ApplicationStage = 'new' | 'incomplete' | 'pending' | 'rejected'

const CTA_LABEL_KEYS: Record<ApplicationStage, string> = {
  new: 'Apply Now',
  incomplete: 'Submit Details',
  pending: 'Edit Details',
  rejected: 'Resubmit Application',
}

function ProgrammeFigure(props: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className='bg-muted/40 flex items-center gap-2.5 rounded-lg p-3'>
      <IconBadge tone='primary' size='sm'>
        {props.icon}
      </IconBadge>
      <div className='min-w-0'>
        <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
          {props.label}
        </div>
        <div className='mt-0.5 truncate text-sm font-semibold tabular-nums'>
          {props.value}
        </div>
      </div>
    </div>
  )
}

function ApplicationStep(props: { index: number; children: React.ReactNode }) {
  return (
    <li className='flex gap-2.5'>
      <span
        aria-hidden='true'
        className='bg-primary/10 text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums'
      >
        {props.index}
      </span>
      <span className='text-muted-foreground text-xs leading-5'>
        {props.children}
      </span>
    </li>
  )
}

/**
 * The referral page before promotion is unlocked.
 *
 * All four pre-approval states share this screen because they differ only in one
 * notice and the wording of one button — the programme terms and the three-step
 * explanation are what the applicant needs in every one of them. Nothing here
 * can show a promo link: the server withholds it until review passes, so there
 * is no link to leak.
 */
export function AgentApplication() {
  const { t } = useTranslation()
  const { overview, setOpen } = useAgent()

  const profile: AgentProfile | null = overview?.profile ?? null
  const programme = overview?.programme
  const freezeDays = programme?.freeze_days ?? 0
  const minWithdrawal =
    overview?.withdrawal?.min_amount ?? WITHDRAWAL_DEFAULTS.MIN_AMOUNT

  // Only the four pre-approval states reach this screen; the caller renders the
  // workbench for active/suspended. Matching `incomplete` by name rather than
  // using it as the fallback keeps an unexpected status off the "an operator
  // added you as an agent" copy, which would be untrue for anything else.
  let stage: ApplicationStage = 'new'
  if (profile?.status === 'pending') stage = 'pending'
  else if (profile?.status === 'rejected') stage = 'rejected'
  else if (profile?.status === 'incomplete') stage = 'incomplete'

  const subjectName =
    profile?.agent_type === 'company'
      ? profile.company_name
      : profile?.subject_name

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='space-y-5 p-4 sm:p-6'>
        <section aria-labelledby={HEADING_ID} className='space-y-3'>
          <div className='flex items-start justify-between gap-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <IconBadge tone='primary' size='lg'>
                <Handshake />
              </IconBadge>
              <div className='min-w-0'>
                <h2 id={HEADING_ID} className='text-base font-semibold'>
                  {t('Become an Agent')}
                </h2>
                <p className='text-muted-foreground mt-0.5 text-xs leading-5'>
                  {t(
                    'Share your promo link and earn a commission whenever a customer you brought in tops up.'
                  )}
                </p>
              </div>
            </div>
            {profile ? (
              <StatusBadge
                label={t(AGENT_STATUSES[profile.status].labelKey)}
                variant={AGENT_STATUSES[profile.status].variant}
                copyable={false}
              />
            ) : null}
          </div>

          {stage === 'incomplete' ? (
            <Alert>
              <Info aria-hidden='true' />
              <AlertTitle>{t('An operator added you as an agent')}</AlertTitle>
              <AlertDescription>
                {t(
                  'Submit your details to finish the application. Your promo link opens once the review passes.'
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {stage === 'pending' ? (
            <Alert>
              <Timer aria-hidden='true' />
              <AlertTitle>{t('Your application is under review')}</AlertTitle>
              <AlertDescription>
                {subjectName
                  ? t('Submitted as {{name}}. We will notify you of the result.', {
                      name: subjectName,
                    })
                  : t(
                      'We will notify you of the result. You can still edit your details while the review is open.'
                    )}
              </AlertDescription>
            </Alert>
          ) : null}

          {stage === 'rejected' ? (
            <Alert variant='destructive'>
              <TriangleAlert aria-hidden='true' />
              <AlertTitle>{t('Your application was rejected')}</AlertTitle>
              <AlertDescription>
                {profile?.reject_reason ||
                  t('No reason was given. Check your details and resubmit.')}
              </AlertDescription>
            </Alert>
          ) : null}
        </section>

        {overview ? (
          <div className='grid gap-2.5 sm:grid-cols-3'>
            <ProgrammeFigure
              icon={<Percent />}
              label={t('Default Commission Rate')}
              value={formatCommissionRate(programme?.default_rate)}
            />
            <ProgrammeFigure
              icon={<Timer />}
              label={t('Freeze Period')}
              value={`${freezeDays} ${t('days')}`}
            />
            <ProgrammeFigure
              icon={<Handshake />}
              label={t('Minimum Withdrawal')}
              value={formatAgentCurrency(minWithdrawal)}
            />
          </div>
        ) : (
          <div className='grid gap-2.5 sm:grid-cols-3'>
            <Skeleton className='h-16 rounded-lg' />
            <Skeleton className='h-16 rounded-lg' />
            <Skeleton className='h-16 rounded-lg' />
          </div>
        )}

        <div className='space-y-2.5 border-t pt-4'>
          <h3 className='text-sm font-semibold'>{t('How it works')}</h3>
          <ol className='space-y-2'>
            <ApplicationStep index={1}>
              {t('Submit your subject and payout details.')}
            </ApplicationStep>
            <ApplicationStep index={2}>
              {programme?.auto_approve
                ? t(
                    'Your application is approved automatically, and your promo link is issued right away.'
                  )
                : t(
                    'An operator reviews your application. Your promo link is issued once it passes.'
                  )}
            </ApplicationStep>
            <ApplicationStep index={3}>
              {freezeDays > 0
                ? t(
                    'Commission is settled automatically when a customer tops up, and can be withdrawn after the {{days}}-day freeze period.',
                    { days: freezeDays }
                  )
                : t(
                    'Commission is settled automatically when a customer tops up, and can be withdrawn once the freeze period is over.'
                  )}
            </ApplicationStep>
          </ol>
        </div>

        <Button className='w-full' onClick={() => setOpen('profile')}>
          {t(CTA_LABEL_KEYS[stage])}
        </Button>
      </CardContent>
    </Card>
  )
}
