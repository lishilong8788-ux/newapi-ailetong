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
import { Plus, ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import type { InvoiceProfile } from '../types'
import { InvoiceProfileCard } from './invoice-profile-card'

interface InvoiceProfilesTabProps {
  profiles: InvoiceProfile[]
  loading: boolean
  busy: boolean
  onCreate: () => void
  onEdit: (profile: InvoiceProfile) => void
  onDelete: (profile: InvoiceProfile) => void
  onSetDefault: (profile: InvoiceProfile) => void
}

export function InvoiceProfilesTab(props: InvoiceProfilesTabProps) {
  const { t } = useTranslation()

  if (props.loading) {
    return (
      <div
        className='grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3'
        aria-hidden='true'
      >
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton
            key={`invoice-profile-skeleton-${index}`}
            className='h-52 rounded-xl'
          />
        ))}
      </div>
    )
  }

  if (props.profiles.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title={t('No invoice profiles yet')}
        description={t(
          'Save an invoice title once and reuse it for every request.'
        )}
        action={
          <Button type='button' size='sm' onClick={props.onCreate}>
            <Plus className='size-4' aria-hidden='true' />
            {t('Add Invoice Title')}
          </Button>
        }
      />
    )
  }

  return (
    <div className='grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3'>
      {props.profiles.map((profile) => (
        <InvoiceProfileCard
          key={profile.id}
          profile={profile}
          busy={props.busy}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
          onSetDefault={props.onSetDefault}
        />
      ))}
    </div>
  )
}
