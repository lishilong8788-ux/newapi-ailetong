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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTimestampToDate } from '@/lib/format'

import { getAgentProfile } from '../api'
import { AGENT_STATUSES, AGENT_TYPE_LABEL_KEYS } from '../constants'
import {
  formatCommissionAmount,
  formatCommissionRate,
  maskBankAccount,
} from '../lib/format'
import { useAgents } from './agents-provider'

type DetailRow = {
  label: string
  value: string
  mono?: boolean
}

function DetailList(props: { title: string; rows: DetailRow[] }) {
  return (
    <section className='space-y-1.5'>
      <h3 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
        {props.title}
      </h3>
      <dl className='bg-muted/40 divide-border divide-y rounded-lg border'>
        {props.rows.map((row) => (
          <div
            key={row.label}
            className='flex items-start justify-between gap-3 px-3 py-2'
          >
            <dt className='text-muted-foreground shrink-0 text-xs'>
              {row.label}
            </dt>
            <dd
              className={
                row.mono
                  ? 'min-w-0 text-end font-mono text-xs break-all'
                  : 'min-w-0 text-end text-sm break-words'
              }
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * Read-only profile for one agent: subject details, roll-ups, and audit trail.
 *
 * The bank account stays masked here even though this endpoint can return it in
 * full. Per the design's read-surface rules only the withdrawal detail sheet — the
 * one place a payment is about to happen — shows a payable account number, so an
 * operator browsing the roster never has one on screen to copy.
 */
export function AgentDetailSheet() {
  const { t } = useTranslation()
  const { open, setOpen, currentAgent } = useAgents()

  const isOpen = open === 'agent-detail' && currentAgent !== null
  const agentId = currentAgent?.id

  const { data, isLoading } = useQuery({
    queryKey: ['agent-admin-profile-detail', agentId],
    queryFn: async () => {
      if (agentId === undefined) return null
      const result = await getAgentProfile(agentId)
      return result.success ? (result.data ?? null) : null
    },
    enabled: isOpen,
    staleTime: 30_000,
  })

  if (!isOpen || !currentAgent) return null

  const profile = data?.profile ?? currentAgent
  const stats = data?.stats
  const statusConfig =
    AGENT_STATUSES[profile.status] ?? AGENT_STATUSES.incomplete
  const rate = formatCommissionRate(profile.commission_rate)

  const subjectRows: DetailRow[] = [
    {
      label: t('Type'),
      value: t(
        AGENT_TYPE_LABEL_KEYS[profile.agent_type] ??
          AGENT_TYPE_LABEL_KEYS.personal
      ),
    },
    { label: t('Commission Rate'), value: rate ?? t('Global default') },
    { label: t('Level'), value: profile.level || '—' },
  ]

  if (profile.agent_type === 'company') {
    subjectRows.push(
      { label: t('Company Name'), value: profile.company_name || '—' },
      { label: t('Tax Number'), value: profile.tax_no || '—', mono: true }
    )
  } else {
    subjectRows.push(
      { label: t('Subject Name'), value: profile.subject_name || '—' },
      { label: t('ID Number'), value: profile.id_no || '—', mono: true }
    )
  }

  const payoutRows: DetailRow[] = [
    { label: t('Bank Name'), value: profile.bank_name || '—' },
    {
      label: t('Bank Account'),
      value: maskBankAccount(profile.bank_account),
      mono: true,
    },
    { label: t('Bank Branch'), value: profile.bank_branch || '—' },
  ]

  const contactRows: DetailRow[] = [
    { label: t('Contact Name'), value: profile.contact_name || '—' },
    {
      label: t('Contact Phone'),
      value: profile.contact_phone || '—',
      mono: true,
    },
    { label: t('Contact Email'), value: profile.contact_email || '—' },
  ]

  const customerRows: DetailRow[] = [
    {
      label: t('Customers'),
      value: String(stats?.customer_count ?? currentAgent.customer_count ?? 0),
    },
    {
      label: t('Paying Customers'),
      value:
        stats?.paid_customer_count === undefined
          ? '—'
          : String(stats.paid_customer_count),
    },
    {
      label: t('Referred Top-ups'),
      value:
        stats?.topup_total === undefined
          ? '—'
          : formatCommissionAmount(stats.topup_total),
    },
    {
      label: t('Total Commission'),
      value: formatCommissionAmount(
        stats?.commission_total ?? currentAgent.agent_commission_total
      ),
    },
    {
      label: t('Pending Payout'),
      value: formatCommissionAmount(
        stats?.commission_available ?? currentAgent.agent_commission_available
      ),
    },
    {
      label: t('Withdrawn'),
      value: formatCommissionAmount(
        stats?.withdrawn_total ?? currentAgent.agent_withdrawn_total
      ),
    },
  ]

  const auditRows: DetailRow[] = [
    {
      label: t('Applied At'),
      value: formatTimestampToDate(profile.created_at),
    },
    {
      label: t('Reviewed At'),
      value: formatTimestampToDate(profile.audit_time),
    },
    {
      label: t('Reviewer'),
      value: profile.audit_by > 0 ? `#${profile.audit_by}` : '—',
    },
    { label: t('Reject Reason'), value: profile.reject_reason || '—' },
    { label: t('Internal Remark'), value: profile.remark || '—' },
  ]

  return (
    <Sheet open onOpenChange={(nextOpen) => !nextOpen && setOpen(null)}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[560px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {currentAgent.username ||
              currentAgent.display_name ||
              `#${profile.user_id}`}
          </SheetTitle>
          <SheetDescription>
            {t('Agent #{{id}} · user #{{userId}}', {
              id: profile.id,
              userId: profile.user_id,
            })}
          </SheetDescription>
          <div className='pt-1'>
            <StatusBadge
              label={t(statusConfig.labelKey)}
              variant={statusConfig.variant}
              copyable={false}
            />
          </div>
        </SheetHeader>

        <div className={sideDrawerFormClassName()}>
          {isLoading && !data ? (
            <div className='space-y-3'>
              <Skeleton className='h-24 w-full' />
              <Skeleton className='h-24 w-full' />
              <Skeleton className='h-24 w-full' />
            </div>
          ) : (
            <>
              <DetailList title={t('Subject')} rows={subjectRows} />
              <DetailList title={t('Customer Overview')} rows={customerRows} />
              <DetailList title={t('Payout Details')} rows={payoutRows} />
              <p className='text-muted-foreground -mt-4 text-xs'>
                {t(
                  'The full account number is shown only on the withdrawal being paid.'
                )}
              </p>
              <DetailList title={t('Contact')} rows={contactRows} />
              <DetailList title={t('Review History')} rows={auditRows} />
            </>
          )}
        </div>

        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button type='button' variant='outline' />}>
            {t('Close')}
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
