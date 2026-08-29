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

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { INVOICE_TITLE_TYPE_LABEL_KEYS } from '../constants'
import type { InvoiceProfile } from '../types'

interface InvoiceProfileCardProps {
  profile: InvoiceProfile
  busy: boolean
  onEdit: (profile: InvoiceProfile) => void
  onDelete: (profile: InvoiceProfile) => void
  onSetDefault: (profile: InvoiceProfile) => void
}

export function InvoiceProfileCard(props: InvoiceProfileCardProps) {
  const { t } = useTranslation()
  const isCompany = props.profile.title_type === 'company'

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-start justify-between gap-2'>
          <span className='min-w-0 truncate' title={props.profile.title}>
            {props.profile.title}
          </span>
          {props.profile.is_default && (
            <StatusBadge
              label={t('Default')}
              variant='success'
              copyable={false}
              filled
            />
          )}
        </CardTitle>
        <StatusBadge
          label={t(INVOICE_TITLE_TYPE_LABEL_KEYS[props.profile.title_type])}
          variant={isCompany ? 'info' : 'neutral'}
          copyable={false}
          className='w-fit'
        />
      </CardHeader>
      <CardContent className='space-y-1.5 text-sm'>
        {isCompany && props.profile.tax_no && (
          <p className='flex gap-2'>
            <span className='text-muted-foreground shrink-0'>
              {t('Tax ID')}:
            </span>
            <span className='min-w-0 truncate font-mono'>
              {props.profile.tax_no}
            </span>
          </p>
        )}
        {props.profile.address && (
          <p className='flex gap-2'>
            <span className='text-muted-foreground shrink-0'>
              {t('Address')}:
            </span>
            <span className='min-w-0 break-words'>{props.profile.address}</span>
          </p>
        )}
        {props.profile.phone && (
          <p className='flex gap-2'>
            <span className='text-muted-foreground shrink-0'>
              {t('Phone')}:
            </span>
            <span className='min-w-0 truncate'>{props.profile.phone}</span>
          </p>
        )}
        {isCompany && props.profile.bank_name && (
          <p className='flex gap-2'>
            <span className='text-muted-foreground shrink-0'>
              {t('Bank Name')}:
            </span>
            <span className='min-w-0 truncate'>{props.profile.bank_name}</span>
          </p>
        )}
        {isCompany && props.profile.bank_account && (
          <p className='flex gap-2'>
            <span className='text-muted-foreground shrink-0'>
              {t('Bank Account')}:
            </span>
            <span className='min-w-0 truncate font-mono'>
              {props.profile.bank_account}
            </span>
          </p>
        )}

        <div className='flex flex-wrap gap-2 pt-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => props.onEdit(props.profile)}
          >
            {t('Edit')}
          </Button>
          {!props.profile.is_default && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={props.busy}
              onClick={() => props.onSetDefault(props.profile)}
            >
              {t('Set as Default')}
            </Button>
          )}
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={props.busy}
            onClick={() => props.onDelete(props.profile)}
          >
            {t('Delete')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
