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
import type { Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { InvoiceRequestFormValues } from '../../lib'
import type { InvoiceProfile } from '../../types'

interface InvoiceRequestProfileFieldProps {
  control: Control<InvoiceRequestFormValues>
  profiles: InvoiceProfile[]
  selectedProfile: InvoiceProfile | undefined
  onManageProfiles: () => void
}

/** Invoice title picker plus a preview of the chosen profile. */
export function InvoiceRequestProfileField(
  props: InvoiceRequestProfileFieldProps
) {
  const { t } = useTranslation()
  const options = props.profiles.map((profile) => ({
    value: String(profile.id),
    label: profile.is_default
      ? `${profile.title} · ${t('Default')}`
      : profile.title,
  }))

  return (
    <FormField
      control={props.control}
      name='profile_id'
      render={({ field }) => (
        <FormItem>
          <div className='flex items-center justify-between gap-2'>
            <FormLabel>{t('Invoice Title')}</FormLabel>
            <Button
              type='button'
              variant='link'
              size='sm'
              className='h-auto p-0'
              onClick={props.onManageProfiles}
            >
              {t('Manage Titles')}
            </Button>
          </div>
          <FormControl>
            <Select
              items={options}
              value={field.value > 0 ? String(field.value) : null}
              onValueChange={(value) =>
                field.onChange(value === null ? 0 : Number(value))
              }
              disabled={props.profiles.length === 0}
            >
              <SelectTrigger className='h-9 w-full'>
                <SelectValue
                  placeholder={t('Please select an invoice title')}
                />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormControl>
          {props.profiles.length === 0 && (
            <FormDescription>
              {t('Add an invoice title first, then submit the request.')}
            </FormDescription>
          )}
          {props.selectedProfile && (
            <ProfilePreview profile={props.selectedProfile} />
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function ProfilePreview(props: { profile: InvoiceProfile }) {
  const { t } = useTranslation()
  const rows = [
    { label: t('Tax ID'), value: props.profile.tax_no },
    { label: t('Address'), value: props.profile.address },
    { label: t('Phone'), value: props.profile.phone },
  ].filter((row) => row.value.trim().length > 0)

  if (rows.length === 0) return null

  return (
    <dl className='bg-muted/50 space-y-1 rounded-lg px-3 py-2 text-xs'>
      {rows.map((row) => (
        <div key={row.label} className='flex gap-2'>
          <dt className='text-muted-foreground shrink-0'>{row.label}:</dt>
          <dd className='min-w-0 break-words'>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
