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
// ============================================================================
// Card-header toolbars
//
// Each list tab keeps its controls on the card header row, next to the tab
// strip, so the table itself can run edge to edge.
// ============================================================================
import { Plus, RefreshCw, Search, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import { getInvoiceStatusFilterOptions } from '../constants'
import { formatMinorAmount } from '../lib'

interface RefreshButtonProps {
  loading: boolean
  onRefresh: () => void
}

function RefreshButton(props: RefreshButtonProps) {
  const { t } = useTranslation()

  return (
    <Button
      type='button'
      variant='outline'
      size='icon'
      className='size-9 shrink-0'
      aria-label={t('Refresh')}
      title={t('Refresh')}
      disabled={props.loading}
      onClick={props.onRefresh}
    >
      <RefreshCw
        className={cn('size-4', props.loading && 'animate-spin')}
        aria-hidden='true'
      />
    </Button>
  )
}

interface PendingOrdersToolbarProps {
  loading: boolean
  selectedCount: number
  selectedTotalMinor: number
  selectionCurrency: string | null
  mixedCurrency: boolean
  onRefresh: () => void
  onRequestSelected: () => void
}

export function PendingOrdersToolbar(props: PendingOrdersToolbarProps) {
  const { t } = useTranslation()
  const showTotal = props.selectedCount > 0 && !props.mixedCurrency

  return (
    <div className='flex flex-wrap items-center gap-2'>
      {props.selectedCount > 0 && (
        <p className='text-muted-foreground mr-1 text-[13px]'>
          {t('{{count}} selected', { count: props.selectedCount })}
          {showTotal && (
            <span className='text-foreground ml-2 font-medium tabular-nums'>
              {formatMinorAmount(
                props.selectedTotalMinor,
                props.selectionCurrency
              )}
            </span>
          )}
        </p>
      )}
      <RefreshButton loading={props.loading} onRefresh={props.onRefresh} />
      <Button
        type='button'
        className='h-9'
        disabled={props.selectedCount === 0 || props.mixedCurrency}
        onClick={props.onRequestSelected}
      >
        <Send className='size-4' aria-hidden='true' />
        {t('Request Invoice in Bulk')}
      </Button>
    </div>
  )
}

interface InvoiceRequestsToolbarProps {
  keyword: string
  status: string
  loading: boolean
  onKeywordChange: (keyword: string) => void
  onStatusChange: (status: string) => void
  onRefresh: () => void
}

export function InvoiceRequestsToolbar(props: InvoiceRequestsToolbarProps) {
  const { t } = useTranslation()
  const statusOptions = getInvoiceStatusFilterOptions(t)
  const searchLabel = t('Search by invoice number or order number...')

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <div className='relative min-w-0 flex-1 sm:w-64 sm:flex-none'>
        <Search
          className='text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2'
          aria-hidden='true'
        />
        <Input
          className='h-9 pl-9'
          value={props.keyword}
          placeholder={searchLabel}
          aria-label={searchLabel}
          onChange={(event) => props.onKeywordChange(event.target.value)}
        />
      </div>
      <Select
        items={statusOptions}
        value={props.status}
        onValueChange={(value) =>
          value !== null && props.onStatusChange(String(value))
        }
      >
        <SelectTrigger className='h-9 w-full sm:w-40'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <RefreshButton loading={props.loading} onRefresh={props.onRefresh} />
    </div>
  )
}

interface InvoiceProfilesToolbarProps {
  loading: boolean
  onRefresh: () => void
  onCreate: () => void
}

export function InvoiceProfilesToolbar(props: InvoiceProfilesToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <RefreshButton loading={props.loading} onRefresh={props.onRefresh} />
      <Button type='button' className='h-9' onClick={props.onCreate}>
        <Plus className='size-4' aria-hidden='true' />
        {t('Add Invoice Title')}
      </Button>
    </div>
  )
}
