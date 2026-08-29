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

import { CopyButton } from '@/components/copy-button'
import { cn } from '@/lib/utils'

import type { InvoiceCopyField } from '../lib'

type InvoiceCopyRowProps = {
  field: InvoiceCopyField
}

/**
 * One read-only worksheet line with its own copy affordance. Per-field copy is
 * the point of this screen: finance retypes these values into the invoicing
 * platform, and a mistyped tax id voids the invoice.
 */
export function InvoiceCopyRow(props: InvoiceCopyRowProps) {
  const { t } = useTranslation()

  return (
    <div className='flex items-start gap-2 border-b py-1.5 last:border-b-0'>
      <span className='text-muted-foreground w-32 shrink-0 pt-1 text-xs sm:w-40 sm:text-sm'>
        {props.field.label}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 pt-1 text-sm break-all',
          props.field.mono && 'font-mono tabular-nums'
        )}
      >
        {props.field.value}
      </span>
      <CopyButton
        value={props.field.value}
        size='sm'
        className='size-7 p-0'
        iconClassName='size-3.5'
        tooltip={t('Copy {{field}}', { field: props.field.label })}
        aria-label={t('Copy {{field}}', { field: props.field.label })}
      />
    </div>
  )
}
