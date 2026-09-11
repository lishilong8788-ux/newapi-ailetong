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
// Shared chrome for the withdrawal and commission record sheets
//
// Both sheets are the same shape — a paged list of cards with label/value rows —
// so the placeholder, the row and the pager live here instead of being written
// twice and drifting apart.
// ============================================================================
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const SKELETON_KEYS = [
  'agent-record-skeleton-1',
  'agent-record-skeleton-2',
  'agent-record-skeleton-3',
  'agent-record-skeleton-4',
]

export function RecordRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-2 text-xs'>
      <span className='text-muted-foreground shrink-0'>{props.label}</span>
      <div className='min-w-0 truncate text-end tabular-nums'>
        {props.children}
      </div>
    </div>
  )
}

/** Renders the loading skeleton or the empty state; renders nothing otherwise. */
export function RecordsPlaceholder(props: {
  isLoading: boolean
  isEmpty: boolean
  emptyTitle: string
  emptyDescription: string
}) {
  if (props.isLoading) {
    return (
      <div className='space-y-3'>
        {SKELETON_KEYS.map((key) => (
          <div key={key} className='space-y-2 rounded-lg border p-3'>
            <div className='flex items-center justify-between'>
              <Skeleton className='h-5 w-24' />
              <Skeleton className='h-5 w-20 rounded-md' />
            </div>
            <Skeleton className='h-3 w-full' />
            <Skeleton className='h-3 w-2/3' />
          </div>
        ))}
      </div>
    )
  }

  if (!props.isEmpty) return null

  return (
    <div className='text-muted-foreground flex min-h-40 flex-col items-center justify-center gap-1 py-10 text-center'>
      <p className='text-sm font-medium'>{props.emptyTitle}</p>
      <p className='text-xs'>{props.emptyDescription}</p>
    </div>
  )
}

export function RecordsPager(props: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation()
  const pageCount = Math.max(1, Math.ceil(props.total / props.pageSize))

  if (props.total === 0) return null

  const firstOnPage = (props.page - 1) * props.pageSize + 1
  const lastOnPage = Math.min(props.page * props.pageSize, props.total)

  return (
    <div className='flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 sm:px-6'>
      <span className='text-muted-foreground text-xs tabular-nums'>
        {t('{{from}}-{{to}} of {{total}}', {
          from: firstOnPage,
          to: lastOnPage,
          total: props.total,
        })}
      </span>
      <div className='flex items-center gap-2'>
        <Button
          variant='outline'
          size='icon-sm'
          disabled={props.page <= 1}
          aria-label={t('Previous page')}
          onClick={() => props.onPageChange(props.page - 1)}
        >
          <ChevronLeft className='size-4' aria-hidden='true' />
        </Button>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {props.page} / {pageCount}
        </span>
        <Button
          variant='outline'
          size='icon-sm'
          disabled={props.page >= pageCount}
          aria-label={t('Next page')}
          onClick={() => props.onPageChange(props.page + 1)}
        >
          <ChevronRight className='size-4' aria-hidden='true' />
        </Button>
      </div>
    </div>
  )
}
