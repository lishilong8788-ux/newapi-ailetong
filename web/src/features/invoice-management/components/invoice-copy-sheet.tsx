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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'

import {
  INVOICE_TITLE_TYPE_LABEL_KEYS,
  INVOICE_TYPE_LABEL_KEYS,
} from '../constants'
import { formatInvoiceCopySheet, getInvoiceCopyGroups } from '../lib'
import type { InvoiceItem, InvoiceRequest } from '../types'
import { InvoiceCopyRow } from './invoice-copy-row'
import { InvoiceOrderBreakdown } from './invoice-order-breakdown'

type InvoiceCopySheetProps = {
  request: InvoiceRequest
  /** Per-order lines, so a merged invoice can show what it covers. */
  items?: InvoiceItem[]
  isLoadingItems?: boolean
}

/**
 * Read-only worksheet finance transcribes into the invoicing platform
 * (Nuonuo / Baiwang / Aisino). Every row copies on its own, and "Copy All"
 * yields one `label: value` block so a single paste carries the whole request.
 */
export function InvoiceCopySheet(props: InvoiceCopySheetProps) {
  const { t } = useTranslation()

  const groups = useMemo(
    () => getInvoiceCopyGroups(props.request, t),
    [props.request, t]
  )
  const copySheetText = useMemo(
    () => formatInvoiceCopySheet(groups, props.request, t),
    [groups, props.request, t]
  )

  return (
    <section className='space-y-3'>
      <header className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0 space-y-1'>
          <h3 className='text-sm font-semibold'>
            {t('Step 1 · Copy into your invoicing software')}
          </h3>
          <div className='flex flex-wrap items-center gap-1.5'>
            <StatusBadge
              label={t(INVOICE_TYPE_LABEL_KEYS[props.request.invoice_type])}
              variant='info'
              copyable={false}
            />
            <StatusBadge
              label={t(INVOICE_TITLE_TYPE_LABEL_KEYS[props.request.title_type])}
              variant='neutral'
              copyable={false}
            />
          </div>
        </div>
        <CopyButton
          value={copySheetText}
          variant='outline'
          size='sm'
          tooltip={t('Copy All')}
          aria-label={t('Copy All')}
          notify
        >
          {t('Copy All')}
        </CopyButton>
      </header>

      {groups.map((group) => (
        <div key={group.id} className='space-y-1.5'>
          <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
            {group.title}
          </h4>
          <div className='bg-muted/40 rounded-lg border px-3 py-1'>
            {group.fields.map((field) => (
              <InvoiceCopyRow key={field.id} field={field} />
            ))}
          </div>
          {group.id === 'content' && (
            <InvoiceOrderBreakdown
              request={props.request}
              items={props.items}
              isLoading={props.isLoadingItems}
            />
          )}
        </div>
      ))}

      {props.request.remark.trim().length > 0 && (
        <div className='space-y-1.5'>
          <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
            {t('Remark')}
          </h4>
          <p className='bg-muted/40 rounded-lg border px-3 py-2 text-sm'>
            {props.request.remark}
          </p>
        </div>
      )}
    </section>
  )
}
