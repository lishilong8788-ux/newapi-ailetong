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
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'

import { INVOICE_NOTICE_KEYS } from '../constants'
import { DEFAULT_INVOICE_CURRENCY, formatMinorAmount } from '../lib'
import type { InvoiceAmountSummary } from '../types'

interface InvoiceSummaryHeaderProps {
  summaries: InvoiceAmountSummary[]
  loading: boolean
}

function InvoiceStatsRowSkeleton() {
  return (
    <div className='grid grid-cols-3 gap-x-6 sm:gap-x-10' aria-hidden='true'>
      {['pending', 'issued', 'invoiceable'].map((key) => (
        <div key={key} className='space-y-2'>
          <Skeleton className='h-3 w-16' />
          <Skeleton className='h-7 w-20' />
        </div>
      ))}
    </div>
  )
}

interface InvoiceStatsRowProps {
  summary: InvoiceAmountSummary
}

function InvoiceStatsRow(props: InvoiceStatsRowProps) {
  const { t } = useTranslation()

  const stats = [
    {
      label: t('Pending Amount'),
      minor: props.summary.pending_minor,
      accent: false,
    },
    {
      label: t('Invoiced Amount'),
      minor: props.summary.issued_minor,
      accent: false,
    },
    {
      label: t('Invoiceable Amount'),
      minor: props.summary.invoiceable_minor,
      accent: true,
    },
  ]

  return (
    <div className='grid grid-cols-3 divide-x'>
      {stats.map((stat) => (
        <div
          key={stat.label}
          className='min-w-0 px-4 first:pl-0 last:pr-0 sm:px-6'
        >
          <div className='text-muted-foreground text-xs whitespace-nowrap'>
            {stat.label}
          </div>
          <div
            className={
              stat.accent
                ? 'text-primary mt-1.5 text-xl font-semibold tracking-tight tabular-nums'
                : 'text-foreground mt-1.5 text-xl font-semibold tracking-tight tabular-nums'
            }
          >
            {formatMinorAmount(stat.minor, props.summary.currency)}
          </div>
        </div>
      ))}
    </div>
  )
}

export function InvoiceSummaryHeader(props: InvoiceSummaryHeaderProps) {
  const { t } = useTranslation()

  return (
    <section className='bg-card rounded-xl border'>
      <div className='flex flex-col gap-5 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8'>
        <div className='min-w-0'>
          <h3 className='text-foreground text-sm font-semibold'>
            {t('Invoicing Notes')}
          </h3>
          <ul className='mt-2.5 space-y-1.5'>
            {INVOICE_NOTICE_KEYS.map((key) => (
              <li
                key={key}
                className='text-muted-foreground flex gap-2 text-[13px] leading-relaxed'
              >
                <span
                  className='bg-primary mt-[7px] size-1 shrink-0 rounded-full'
                  aria-hidden='true'
                />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className='shrink-0'>
          {props.loading ? (
            <InvoiceStatsRowSkeleton />
          ) : (
            <div className='flex flex-col gap-3'>
              {props.summaries.length === 0 ? (
                <InvoiceStatsRow
                  summary={{
                    currency: DEFAULT_INVOICE_CURRENCY,
                    pending_minor: 0,
                    issued_minor: 0,
                    invoiceable_minor: 0,
                  }}
                />
              ) : (
                props.summaries.map((summary) => (
                  <InvoiceStatsRow key={summary.currency} summary={summary} />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
