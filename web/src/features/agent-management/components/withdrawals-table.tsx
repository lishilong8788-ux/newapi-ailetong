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
import { getRouteApi } from '@tanstack/react-router'
import { Banknote, Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { exportAgentData, listWithdrawals } from '../api'
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  getWithdrawalMethodOptions,
  getWithdrawalStatusOptions,
} from '../constants'
import type { AgentWithdrawal } from '../types'
import { useAgents } from './agents-provider'
import { useWithdrawalsColumns } from './withdrawals-columns'

const route = getRouteApi('/_authenticated/agent-management/')

type RangeFilters = {
  minAmount: string
  maxAmount: string
  startDate: string
  endDate: string
  agent: string
}

const EMPTY_RANGE_FILTERS: RangeFilters = {
  minAmount: '',
  maxAmount: '',
  startDate: '',
  endDate: '',
  agent: '',
}

function toTimestamp(dateValue: string, endOfDay: boolean): number | null {
  if (!dateValue) return null
  const parsed = new Date(`${dateValue}T${endOfDay ? '23:59:59' : '00:00:00'}`)
  const ms = parsed.getTime()
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

/**
 * Finance's work queue.
 *
 * Ordered oldest-submitted first, not newest: this is a first-come-first-served
 * payout queue, and a newest-first list buries the request that has been waiting
 * longest at the back. The amount/date/agent filters narrow the fetched page in
 * the browser because the list endpoint takes only status and method — they are
 * review aids, never the basis for a payment decision, which is always made from
 * the detail sheet.
 */
export function WithdrawalsTable() {
  const { t } = useTranslation()
  const columns = useWithdrawalsColumns()
  const { refreshTrigger } = useAgents()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [isExporting, setIsExporting] = useState(false)
  const [ranges, setRanges] = useState<RangeFilters>(EMPTY_RANGE_FILTERS)

  const {
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: false },
    columnFilters: [
      { columnId: 'status', searchKey: 'status', type: 'array' },
      { columnId: 'method', searchKey: 'method', type: 'array' },
    ],
  })

  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []
  const methodFilter =
    (columnFilters.find((filter) => filter.id === 'method')?.value as
      | string[]
      | undefined) ?? []

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'agent-admin-withdrawals',
      pagination.pageIndex + 1,
      pagination.pageSize,
      statusFilter[0] ?? '',
      methodFilter[0] ?? '',
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await listWithdrawals({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        status: statusFilter[0] ?? '',
        method: methodFilter[0] ?? '',
      })

      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.LOAD_WITHDRAWALS_FAILED))
        return {
          items: [] as AgentWithdrawal[],
          total: 0,
          pending: 0,
          approved: 0,
        }
      }

      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
        pending: result.data?.counts?.pending ?? 0,
        approved: result.data?.counts?.approved ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const minAmount = ranges.minAmount ? Number(ranges.minAmount) : null
  const maxAmount = ranges.maxAmount ? Number(ranges.maxAmount) : null
  const startTime = toTimestamp(ranges.startDate, false)
  const endTime = toTimestamp(ranges.endDate, true)
  const agentQuery = ranges.agent.trim().toLowerCase()

  const rows = (data?.items ?? [])
    .filter((item) => {
      if (minAmount !== null && item.amount < minAmount) return false
      if (maxAmount !== null && item.amount > maxAmount) return false
      if (startTime !== null && item.create_time < startTime) return false
      if (endTime !== null && item.create_time > endTime) return false
      if (agentQuery.length > 0) {
        const haystack = `${item.username} ${item.display_name} ${item.agent_user_id}`
        if (!haystack.toLowerCase().includes(agentQuery)) return false
      }
      return true
    })
    // Oldest first: whoever waited longest gets looked at first.
    .sort((left, right) => left.create_time - right.create_time)

  const { table } = useDataTable({
    data: rows,
    columns,
    columnFilters,
    pagination,
    onPaginationChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: data?.total ?? 0,
    ensurePageInRange,
  })

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const blob = await exportAgentData('withdrawals')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `withdrawals-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(t(SUCCESS_MESSAGES.EXPORTED))
    } catch {
      toast.error(t(ERROR_MESSAGES.EXPORT_FAILED))
    } finally {
      setIsExporting(false)
    }
  }

  const hasRangeFilters = Object.values(ranges).some(
    (value) => value.trim().length > 0
  )

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      {/* The backlog, stated before the table: finance needs the size of the
          queue without counting rows or paging to the end. */}
      <div
        className='flex flex-wrap items-center gap-2'
        role='status'
        aria-live='polite'
      >
        <StatusBadge
          label={t('{{count}} awaiting review', {
            count: data?.pending ?? 0,
          })}
          variant='warning'
          size='lg'
          filled
          copyable={false}
        />
        <StatusBadge
          label={t('{{count}} awaiting payment', {
            count: data?.approved ?? 0,
          })}
          variant='info'
          size='lg'
          filled
          copyable={false}
        />
        <span className='text-muted-foreground text-xs'>
          {t('Oldest requests are listed first.')}
        </span>
      </div>

      <div className='flex min-h-0 flex-1 flex-col'>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
          emptyTitle={t('No Withdrawal Requests Found')}
          emptyDescription={t(
            'No withdrawal requests match the current filters.'
          )}
          emptyIcon={<Banknote />}
          skeletonKeyPrefix='agent-withdrawals-skeleton'
          applyHeaderSize
          toolbarProps={{
            filters: [
              {
                columnId: 'status',
                title: t('Status'),
                options: getWithdrawalStatusOptions(t),
                singleSelect: true,
              },
              {
                columnId: 'method',
                title: t('Method'),
                options: getWithdrawalMethodOptions(t),
                singleSelect: true,
              },
            ],
            customSearch: (
              <div className='flex items-center gap-2'>
                <Label htmlFor='withdrawal-agent-filter' className='sr-only'>
                  {t('Agent')}
                </Label>
                <Input
                  id='withdrawal-agent-filter'
                  value={ranges.agent}
                  onChange={(event) =>
                    setRanges((previous) => ({
                      ...previous,
                      agent: event.target.value,
                    }))
                  }
                  placeholder={t('Filter by agent name or ID...')}
                  className='w-full sm:w-[220px]'
                />
              </div>
            ),
            expandable: (
              <>
                <div className='flex items-center gap-2'>
                  <Label
                    htmlFor='withdrawal-min-amount'
                    className='text-muted-foreground text-xs'
                  >
                    {t('Amount from')}
                  </Label>
                  <Input
                    id='withdrawal-min-amount'
                    type='number'
                    inputMode='decimal'
                    min={0}
                    value={ranges.minAmount}
                    onChange={(event) =>
                      setRanges((previous) => ({
                        ...previous,
                        minAmount: event.target.value,
                      }))
                    }
                    className='w-[110px]'
                  />
                </div>
                <div className='flex items-center gap-2'>
                  <Label
                    htmlFor='withdrawal-max-amount'
                    className='text-muted-foreground text-xs'
                  >
                    {t('to')}
                  </Label>
                  <Input
                    id='withdrawal-max-amount'
                    type='number'
                    inputMode='decimal'
                    min={0}
                    value={ranges.maxAmount}
                    onChange={(event) =>
                      setRanges((previous) => ({
                        ...previous,
                        maxAmount: event.target.value,
                      }))
                    }
                    className='w-[110px]'
                  />
                </div>
                <div className='flex items-center gap-2'>
                  <Label
                    htmlFor='withdrawal-start-date'
                    className='text-muted-foreground text-xs'
                  >
                    {t('Submitted from')}
                  </Label>
                  <Input
                    id='withdrawal-start-date'
                    type='date'
                    value={ranges.startDate}
                    onChange={(event) =>
                      setRanges((previous) => ({
                        ...previous,
                        startDate: event.target.value,
                      }))
                    }
                    className='w-[150px]'
                  />
                </div>
                <div className='flex items-center gap-2'>
                  <Label
                    htmlFor='withdrawal-end-date'
                    className='text-muted-foreground text-xs'
                  >
                    {t('to')}
                  </Label>
                  <Input
                    id='withdrawal-end-date'
                    type='date'
                    value={ranges.endDate}
                    onChange={(event) =>
                      setRanges((previous) => ({
                        ...previous,
                        endDate: event.target.value,
                      }))
                    }
                    className='w-[150px]'
                  />
                </div>
              </>
            ),
            hasExpandedActiveFilters: hasRangeFilters,
            hasAdditionalFilters: hasRangeFilters,
            onReset: () => setRanges(EMPTY_RANGE_FILTERS),
            preActions: (
              <Button
                size='sm'
                variant='outline'
                disabled={isExporting}
                onClick={() => void handleExport()}
              >
                <Download className='size-4' aria-hidden='true' />
                {t('Export CSV')}
              </Button>
            ),
          }}
        />
      </div>
    </div>
  )
}
