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
import { Download, Lock, Plus, ScrollText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { exportAgentData, listCommissions } from '../api'
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  getCommissionSourceTypeOptions,
  getCommissionStatusOptions,
} from '../constants'
import type { AgentCommission } from '../types'
import { useAgents } from './agents-provider'
import { useCommissionsColumns } from './commissions-columns'

const route = getRouteApi('/_authenticated/agent-management/')

type LedgerFilters = {
  agentUserId: string
  fromUserId: string
  sourceType: string
  minAmount: string
  maxAmount: string
  startDate: string
  endDate: string
}

const EMPTY_LEDGER_FILTERS: LedgerFilters = {
  agentUserId: '',
  fromUserId: '',
  sourceType: '',
  minAmount: '',
  maxAmount: '',
  startDate: '',
  endDate: '',
}

function toTimestamp(dateValue: string, endOfDay: boolean): number | undefined {
  if (!dateValue) return undefined
  const parsed = new Date(`${dateValue}T${endOfDay ? '23:59:59' : '00:00:00'}`)
  const ms = parsed.getTime()
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000)
}

function toNumber(value: string): number | undefined {
  if (value.trim().length === 0) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * The platform-wide commission ledger, used for reconciliation and disputes.
 *
 * Every filter here is a real query parameter, so the numbers on screen are the
 * numbers the server counted — unlike the other two tabs, nothing is narrowed in
 * the browser. The filters are applied on an explicit Search rather than on each
 * keystroke because an amount or date range is only meaningful once it is fully
 * typed.
 */
export function CommissionsTable() {
  const { t } = useTranslation()
  const columns = useCommissionsColumns()
  const { refreshTrigger, setOpen, setCurrentAgent } = useAgents()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [isExporting, setIsExporting] = useState(false)
  const [draft, setDraft] = useState<LedgerFilters>(EMPTY_LEDGER_FILTERS)
  const [applied, setApplied] = useState<LedgerFilters>(EMPTY_LEDGER_FILTERS)

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
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })

  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []

  const params = {
    agent_user_id: toNumber(applied.agentUserId),
    from_user_id: toNumber(applied.fromUserId),
    source_type: applied.sourceType,
    min_amount: toNumber(applied.minAmount),
    max_amount: toNumber(applied.maxAmount),
    start_time: toTimestamp(applied.startDate, false),
    end_time: toTimestamp(applied.endDate, true),
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'agent-admin-commissions',
      pagination.pageIndex + 1,
      pagination.pageSize,
      statusFilter[0] ?? '',
      params,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await listCommissions({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        status: statusFilter[0] ?? '',
        ...params,
      })

      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.LOAD_COMMISSIONS_FAILED))
        return { items: [] as AgentCommission[], total: 0 }
      }

      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const { table } = useDataTable({
    data: data?.items ?? [],
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
      const blob = await exportAgentData('commissions')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `commissions-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(t(SUCCESS_MESSAGES.EXPORTED))
    } catch {
      toast.error(t(ERROR_MESSAGES.EXPORT_FAILED))
    } finally {
      setIsExporting(false)
    }
  }

  const hasDraftFilters = Object.values(draft).some(
    (value) => value.trim().length > 0
  )

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      {/* Stated up front, because it changes how the table is read: a row here is
          a fact, not a field. Corrections arrive as new rows underneath. */}
      <div className='bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-xs'>
        <Lock className='mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
        <p>
          {t(
            'Append-only ledger. Adjustments add a new row; existing rows are never edited or deleted.'
          )}
        </p>
      </div>

      <div className='flex min-h-0 flex-1 flex-col'>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
          emptyTitle={t('No Commission Records Found')}
          emptyDescription={t(
            'No commission records match the current filters.'
          )}
          emptyIcon={<ScrollText />}
          skeletonKeyPrefix='agent-commissions-skeleton'
          applyHeaderSize
          toolbarProps={{
            filters: [
              {
                columnId: 'status',
                title: t('Status'),
                options: getCommissionStatusOptions(t),
                singleSelect: true,
              },
            ],
            customSearch: (
              <div className='flex items-center gap-2'>
                <Label htmlFor='ledger-agent-filter' className='sr-only'>
                  {t('Agent user ID')}
                </Label>
                <Input
                  id='ledger-agent-filter'
                  type='number'
                  min={1}
                  value={draft.agentUserId}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      agentUserId: event.target.value,
                    }))
                  }
                  placeholder={t('Agent user ID')}
                  className='w-full sm:w-[150px]'
                />
              </div>
            ),
            additionalSearch: (
              <>
                <Label htmlFor='ledger-customer-filter' className='sr-only'>
                  {t('Customer user ID')}
                </Label>
                <Input
                  id='ledger-customer-filter'
                  type='number'
                  min={1}
                  value={draft.fromUserId}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      fromUserId: event.target.value,
                    }))
                  }
                  placeholder={t('Customer user ID')}
                  className='w-full sm:w-[160px]'
                />
                <Label htmlFor='ledger-source-filter' className='sr-only'>
                  {t('Source Type')}
                </Label>
                <NativeSelect
                  id='ledger-source-filter'
                  aria-label={t('Source Type')}
                  value={draft.sourceType}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      sourceType: event.target.value,
                    }))
                  }
                  className='w-[160px]'
                >
                  <NativeSelectOption value=''>
                    {t('All source types')}
                  </NativeSelectOption>
                  {getCommissionSourceTypeOptions(t).map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </>
            ),
            expandable: (
              <>
                <div className='flex items-center gap-2'>
                  <Label
                    htmlFor='ledger-min-amount'
                    className='text-muted-foreground text-xs'
                  >
                    {t('Amount from')}
                  </Label>
                  <Input
                    id='ledger-min-amount'
                    type='number'
                    inputMode='decimal'
                    value={draft.minAmount}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        minAmount: event.target.value,
                      }))
                    }
                    className='w-[110px]'
                  />
                </div>
                <div className='flex items-center gap-2'>
                  <Label
                    htmlFor='ledger-max-amount'
                    className='text-muted-foreground text-xs'
                  >
                    {t('to')}
                  </Label>
                  <Input
                    id='ledger-max-amount'
                    type='number'
                    inputMode='decimal'
                    value={draft.maxAmount}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        maxAmount: event.target.value,
                      }))
                    }
                    className='w-[110px]'
                  />
                </div>
                <div className='flex items-center gap-2'>
                  <Label
                    htmlFor='ledger-start-date'
                    className='text-muted-foreground text-xs'
                  >
                    {t('From')}
                  </Label>
                  <Input
                    id='ledger-start-date'
                    type='date'
                    value={draft.startDate}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        startDate: event.target.value,
                      }))
                    }
                    className='w-[150px]'
                  />
                </div>
                <div className='flex items-center gap-2'>
                  <Label
                    htmlFor='ledger-end-date'
                    className='text-muted-foreground text-xs'
                  >
                    {t('to')}
                  </Label>
                  <Input
                    id='ledger-end-date'
                    type='date'
                    value={draft.endDate}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        endDate: event.target.value,
                      }))
                    }
                    className='w-[150px]'
                  />
                </div>
              </>
            ),
            hasExpandedActiveFilters: hasDraftFilters,
            hasAdditionalFilters: hasDraftFilters,
            onSearch: () => setApplied(draft),
            searchLoading: isFetching,
            onReset: () => {
              setDraft(EMPTY_LEDGER_FILTERS)
              setApplied(EMPTY_LEDGER_FILTERS)
            },
            preActions: (
              <>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => {
                    setCurrentAgent(null)
                    setOpen('commission-adjust')
                  }}
                >
                  <Plus className='size-4' aria-hidden='true' />
                  {t('Manual Adjustment')}
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={isExporting}
                  onClick={() => void handleExport()}
                >
                  <Download className='size-4' aria-hidden='true' />
                  {t('Export CSV')}
                </Button>
              </>
            ),
          }}
        />
      </div>
    </div>
  )
}
