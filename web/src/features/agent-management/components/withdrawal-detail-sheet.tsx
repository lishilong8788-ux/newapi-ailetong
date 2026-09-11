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

import { CopyButton } from '@/components/copy-button'
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

import { getWithdrawal } from '../api'
import {
  AGENT_TYPE_LABEL_KEYS,
  COMMISSION_SOURCE_TYPE_LABEL_KEYS,
  WITHDRAWAL_METHOD_LABEL_KEYS,
  WITHDRAWAL_STATUSES,
} from '../constants'
import {
  formatAgentIdentity,
  formatCommissionAmount,
  formatCommissionRate,
  formatWithdrawalNo,
} from '../lib/format'
import type { WithdrawalCommissionLine } from '../types'
import { useAgents } from './agents-provider'

type SnapshotRow = {
  label: string
  value: string
  mono?: boolean
  copyValue?: string
  copyLabel?: string
}

function SnapshotList(props: { title: string; rows: SnapshotRow[] }) {
  return (
    <section className='space-y-1.5'>
      <h3 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
        {props.title}
      </h3>
      <dl className='bg-muted/40 divide-border divide-y rounded-lg border'>
        {props.rows.map((row) => (
          <div
            key={row.label}
            className='flex items-start justify-between gap-2 px-3 py-2'
          >
            <dt className='text-muted-foreground shrink-0 text-xs'>
              {row.label}
            </dt>
            <dd className='flex min-w-0 items-center gap-1'>
              <span
                className={
                  row.mono
                    ? 'min-w-0 text-end font-mono text-xs break-all'
                    : 'min-w-0 text-end text-sm break-words'
                }
              >
                {row.value}
              </span>
              {row.copyValue && row.copyLabel && (
                <CopyButton
                  value={row.copyValue}
                  size='sm'
                  className='size-7 shrink-0 p-0'
                  iconClassName='size-3.5'
                  tooltip={row.copyLabel}
                  aria-label={row.copyLabel}
                />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * The commission rows this withdrawal claimed, per customer and per order.
 *
 * Not decoration: before money leaves the platform finance has to be able to
 * point at the top-ups the payout is drawn from, and confirm the sum matches the
 * amount requested. Modelled on the invoice order breakdown for the same reason —
 * an aggregate with no lines behind it cannot be checked.
 */
function ClaimedCommissions(props: {
  lines: WithdrawalCommissionLine[]
  requestedAmount: number
  isLoading?: boolean
}) {
  const { t } = useTranslation()

  if (props.isLoading) {
    return (
      <section className='space-y-1.5'>
        <h3 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
          {t('Funds Source')}
        </h3>
        <Skeleton className='h-24 w-full' />
      </section>
    )
  }

  const claimedTotal = props.lines.reduce((sum, line) => sum + line.amount, 0)
  // Compared in fen: the amounts are yuan decimals and a float subtraction can
  // leave a sub-cent residue that would flag every healthy withdrawal.
  const mismatch =
    Math.round(claimedTotal * 100) !== Math.round(props.requestedAmount * 100)

  return (
    <section className='space-y-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
          {t('Funds Source')}
        </h3>
        <span className='text-muted-foreground text-xs'>
          {t('{{count}} commission record(s)', { count: props.lines.length })}
        </span>
      </div>

      {props.lines.length === 0 ? (
        <p className='bg-muted/40 rounded-lg border px-3 py-2 text-sm'>
          {t('No commission records are attached to this withdrawal.')}
        </p>
      ) : (
        <>
          <ul className='bg-background divide-border divide-y rounded-lg border'>
            {props.lines.map((line, index) => (
              <li key={line.id} className='flex items-start gap-2 px-2.5 py-2'>
                <span className='text-muted-foreground w-5 shrink-0 text-xs tabular-nums'>
                  {index + 1}
                </span>
                <div className='min-w-0 flex-1 space-y-0.5'>
                  <span className='block truncate text-sm'>
                    {formatAgentIdentity(line.from_username, line.from_user_id)}
                  </span>
                  <span className='text-muted-foreground block font-mono text-xs break-all'>
                    {t(
                      COMMISSION_SOURCE_TYPE_LABEL_KEYS[line.source_type] ??
                        COMMISSION_SOURCE_TYPE_LABEL_KEYS.topup
                    )}
                    {' · #'}
                    {line.source_id}
                  </span>
                  <span className='text-muted-foreground block text-xs'>
                    {t('Base {{base}} × {{rate}}', {
                      base: formatCommissionAmount(line.base_amount),
                      rate: formatCommissionRate(line.rate) ?? '—',
                    })}
                    {' · '}
                    {formatTimestampToDate(line.create_time)}
                  </span>
                </div>
                <span className='shrink-0 font-mono text-xs font-medium tabular-nums'>
                  {formatCommissionAmount(line.amount)}
                </span>
              </li>
            ))}
          </ul>

          <div className='flex items-center justify-between gap-2 px-2.5'>
            <span className='text-muted-foreground text-xs'>
              {t('Claimed total')}
            </span>
            <span className='font-mono text-xs font-medium tabular-nums'>
              {formatCommissionAmount(claimedTotal)}
            </span>
          </div>

          {mismatch && (
            <p
              className='text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-xs'
              role='alert'
            >
              {t(
                'The claimed records total {{claimed}} but the request is for {{requested}}. Do not pay until this is reconciled.',
                {
                  claimed: formatCommissionAmount(claimedTotal),
                  requested: formatCommissionAmount(props.requestedAmount),
                }
              )}
            </p>
          )}
        </>
      )}
    </section>
  )
}

/**
 * Everything finance needs to make a payment: the amounts, the payee's full bank
 * details, and the commission rows the money is drawn from.
 *
 * This is the one admin surface that shows an unmasked account number — the
 * design's read rules allow it here precisely because a payment is being made,
 * and nowhere else. The value is still treated as optional: a payload without it
 * has to read as "not provided", never as a blank field to be typed over.
 */
export function WithdrawalDetailSheet() {
  const { t } = useTranslation()
  const { open, setOpen, currentWithdrawal } = useAgents()

  const isOpen = open === 'withdrawal-detail' && currentWithdrawal !== null
  const withdrawalId = currentWithdrawal?.id

  const { data, isLoading } = useQuery({
    queryKey: ['agent-admin-withdrawal-detail', withdrawalId],
    queryFn: async () => {
      if (withdrawalId === undefined) return null
      const result = await getWithdrawal(withdrawalId)
      return result.success ? (result.data ?? null) : null
    },
    enabled: isOpen,
    staleTime: 30_000,
  })

  if (!isOpen || !currentWithdrawal) return null

  const withdrawal = data?.withdrawal ?? currentWithdrawal
  const snapshot = data?.profile_snapshot
  const statusConfig =
    WITHDRAWAL_STATUSES[withdrawal.status] ?? WITHDRAWAL_STATUSES.pending
  const isBankPayout = withdrawal.method === 'bank'

  const amountRows: SnapshotRow[] = [
    {
      label: t('Requested'),
      value: formatCommissionAmount(withdrawal.amount),
      mono: true,
    },
    {
      label: t('Fee'),
      value: formatCommissionAmount(withdrawal.fee),
      mono: true,
    },
    {
      label: t('Net Payout'),
      value: formatCommissionAmount(withdrawal.actual_amount),
      mono: true,
    },
    {
      label: t('Method'),
      value: t(
        WITHDRAWAL_METHOD_LABEL_KEYS[withdrawal.method] ??
          WITHDRAWAL_METHOD_LABEL_KEYS.bank
      ),
    },
    {
      label: t('Submitted At'),
      value: formatTimestampToDate(withdrawal.create_time),
    },
    {
      label: t('Reviewed At'),
      value: formatTimestampToDate(withdrawal.audit_time),
    },
    {
      label: t('Paid At'),
      value: formatTimestampToDate(withdrawal.pay_time),
    },
    {
      label: t('Reviewer'),
      value: withdrawal.audit_by > 0 ? `#${withdrawal.audit_by}` : '—',
    },
    {
      label: t('Payment Voucher'),
      value: withdrawal.pay_voucher || '—',
      mono: true,
    },
    { label: t('Reject Reason'), value: withdrawal.reject_reason || '—' },
  ]

  const payeeName =
    snapshot?.agent_type === 'company'
      ? snapshot?.company_name
      : snapshot?.subject_name
  const bankAccount = snapshot?.bank_account?.trim()

  const payeeRows: SnapshotRow[] = [
    {
      label: t('Subject Type'),
      value: snapshot?.agent_type
        ? t(AGENT_TYPE_LABEL_KEYS[snapshot.agent_type])
        : '—',
    },
    { label: t('Payee Name'), value: payeeName || '—' },
    { label: t('Bank Name'), value: snapshot?.bank_name || '—' },
    {
      label: t('Bank Account'),
      value: bankAccount || t('Not provided'),
      mono: true,
      copyValue: bankAccount || undefined,
      copyLabel: bankAccount ? t('Copy bank account') : undefined,
    },
    { label: t('Bank Branch'), value: snapshot?.bank_branch || '—' },
    { label: t('Contact Name'), value: snapshot?.contact_name || '—' },
    {
      label: t('Contact Phone'),
      value: snapshot?.contact_phone || '—',
      mono: true,
    },
  ]

  return (
    <Sheet open onOpenChange={(nextOpen) => !nextOpen && setOpen(null)}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[600px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{formatWithdrawalNo(withdrawal.id)}</SheetTitle>
          <SheetDescription>
            {formatAgentIdentity(
              withdrawal.username || withdrawal.display_name,
              withdrawal.agent_user_id
            )}
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
          <SnapshotList title={t('Withdrawal')} rows={amountRows} />

          <ClaimedCommissions
            lines={data?.commissions ?? []}
            requestedAmount={withdrawal.amount}
            isLoading={isLoading && !data}
          />

          {isBankPayout && (
            <>
              <SnapshotList title={t('Payee Snapshot')} rows={payeeRows} />
              <p className='text-muted-foreground -mt-4 text-xs'>
                {t(
                  'Captured when the request was submitted, so later profile edits do not change this payout.'
                )}
              </p>
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
