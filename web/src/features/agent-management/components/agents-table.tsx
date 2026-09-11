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
import { BadgeCheck, Download, Percent, UserCog } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTableBulkActions,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { exportAgentData, listAgentProfiles } from '../api'
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  getAgentStatusOptions,
  getAgentTypeOptions,
} from '../constants'
import type { AgentListItem } from '../types'
import { useAgentsColumns } from './agents-columns'
import { useAgents } from './agents-provider'

const route = getRouteApi('/_authenticated/agent-management/')

const TYPE_FILTER_ALL = ''

export function AgentsTable() {
  const { t } = useTranslation()
  const columns = useAgentsColumns()
  const { refreshTrigger, setOpen, setBatchAgents, setCurrentAgent } =
    useAgents()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [isExporting, setIsExporting] = useState(false)
  // The route's search schema has no `agent_type` key and the routes are owned
  // elsewhere, so this one filter lives in component state instead of the URL.
  const [typeFilter, setTypeFilter] = useState<string>(TYPE_FILTER_ALL)

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'keyword' },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })

  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []
  const requestStatus = statusFilter[0] ?? ''

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'agent-admin-profiles',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      requestStatus,
      typeFilter,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await listAgentProfiles({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        status: requestStatus,
        keyword: globalFilter,
      })

      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.LOAD_AGENTS_FAILED))
        return { items: [] as AgentListItem[], total: 0 }
      }

      const items = result.data?.items ?? []
      // Type is not a server-side parameter, so it narrows the page in hand.
      // Total stays the server's count: paginating a locally filtered slice
      // would report a page count the API cannot honour.
      return {
        items: typeFilter
          ? items.filter((item) => item.agent_type === typeFilter)
          : items,
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    enableRowSelection: true,
    columnFilters,
    globalFilter,
    pagination,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: data?.total ?? 0,
    ensurePageInRange,
  })

  const selectedAgents = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original)

  const openBatchDialog = (
    dialog: 'agent-batch-approve' | 'agent-batch-rate'
  ) => {
    setCurrentAgent(null)
    setBatchAgents(selectedAgents)
    setOpen(dialog)
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const blob = await exportAgentData('agents')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `agents-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(t(SUCCESS_MESSAGES.EXPORTED))
    } catch {
      toast.error(t(ERROR_MESSAGES.EXPORT_FAILED))
    } finally {
      setIsExporting(false)
    }
  }

  const pendingCount = (data?.items ?? []).filter(
    (item) => item.status === 'pending'
  ).length

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No Agents Found')}
      emptyDescription={t('No agents match the current filters.')}
      emptyIcon={<UserCog />}
      skeletonKeyPrefix='agent-profiles-skeleton'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Filter by username, subject or contact...'),
        searchDebounceMs: 500,
        searchClassName: 'sm:w-[240px] lg:w-[300px]',
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: getAgentStatusOptions(t),
            singleSelect: true,
          },
        ],
        additionalSearch: (
          <div className='flex items-center gap-2'>
            <Label htmlFor='agent-type-filter' className='sr-only'>
              {t('Type')}
            </Label>
            <NativeSelect
              id='agent-type-filter'
              aria-label={t('Type')}
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className='w-[130px]'
            >
              <NativeSelectOption value={TYPE_FILTER_ALL}>
                {t('All types')}
              </NativeSelectOption>
              {getAgentTypeOptions(t).map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ),
        hasAdditionalFilters: typeFilter !== TYPE_FILTER_ALL,
        onReset: () => setTypeFilter(TYPE_FILTER_ALL),
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
        leftActions:
          pendingCount > 0 ? (
            <span className='text-warning text-sm'>
              {t('{{count}} agent(s) awaiting review on this page', {
                count: pendingCount,
              })}
            </span>
          ) : undefined,
      }}
      bulkActions={
        <DataTableBulkActions table={table} entityName='agent'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => openBatchDialog('agent-batch-approve')}
          >
            <BadgeCheck className='size-3.5' aria-hidden='true' />
            {t('Approve')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => openBatchDialog('agent-batch-rate')}
          >
            <Percent className='size-3.5' aria-hidden='true' />
            {t('Adjust commission rate')}
          </Button>
        </DataTableBulkActions>
      }
    />
  )
}
