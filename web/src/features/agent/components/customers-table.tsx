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
import { Download, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  DataTableToolbar,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { cn } from '@/lib/utils'

import { exportAgentCustomers, listAgentCustomers } from '../api'
import {
  AGENT_CUSTOMERS_PAGE_SIZE,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../constants'
import { useAgent } from './agent-provider'
import { useCustomersColumns } from './customers-columns'
import { CustomersMobileList } from './customers-mobile-list'

const route = getRouteApi('/_authenticated/agent/')

/** Widened cell padding so the outer columns clear the card edge. */
const TABLE_CLASS = '[&_td]:px-4 [&_th]:px-4'
const TABLE_HEADER_ROW_CLASS = '[&_th]:bg-muted/60 [&_th]:h-11'
const TABLE_ROW_CLASS =
  'transition-colors hover:[background-color:var(--muted)]'

export function CustomersTable() {
  const { t } = useTranslation()
  const columns = useCustomersColumns()
  const { refreshTrigger } = useAgent()
  const [isExporting, setIsExporting] = useState(false)

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
    pagination: { defaultPage: 1, defaultPageSize: AGENT_CUSTOMERS_PAGE_SIZE },
    globalFilter: { enabled: true, key: 'keyword' },
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'agent-customers',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await listAgentCustomers({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        keyword: globalFilter,
      })

      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.CUSTOMERS_FAILED))
        return { items: [], total: 0 }
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
    onColumnFiltersChange,
    globalFilter,
    pagination,
    onPaginationChange,
    onGlobalFilterChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: data?.total ?? 0,
    ensurePageInRange,
  })

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const blob = await exportAgentCustomers()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `agent-customers-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(t(SUCCESS_MESSAGES.EXPORTED))
    } catch {
      toast.error(t(ERROR_MESSAGES.EXPORT_FAILED))
    } finally {
      setIsExporting(false)
    }
  }

  // One card holding the toolbar and the table, matching the invoice pages: the
  // card draws the frame, so the table drops its own border.
  return (
    <section
      aria-label={t('My Customers')}
      className='bg-card flex h-full min-h-0 flex-col gap-0 overflow-hidden rounded-xl border'
    >
      <div className='flex shrink-0 flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4'>
        <h3 className='text-sm font-semibold'>{t('My Customers')}</h3>

        <div className='flex flex-wrap items-center gap-2 sm:flex-nowrap'>
          <DataTableToolbar
            table={table}
            searchPlaceholder={t('Search by username or display name...')}
            searchDebounceMs={500}
            searchClassName='sm:w-[220px] lg:w-[280px]'
            className='sm:flex-nowrap'
          />
          <Button
            size='sm'
            variant='outline'
            disabled={isExporting}
            onClick={() => void handleExport()}
          >
            <Download className='size-4' aria-hidden='true' />
            {t('Export CSV')}
          </Button>
        </div>
      </div>

      <div className='min-h-0 flex-1'>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
          emptyTitle={t('No Customers Yet')}
          emptyDescription={t(
            'Share your promo link to start inviting customers.'
          )}
          emptyIcon={<Users />}
          skeletonKeyPrefix='agent-customers-skeleton'
          applyHeaderSize
          toolbarProps={null}
          tableClassName={cn('rounded-none border-0', TABLE_CLASS)}
          tableHeaderClassName={TABLE_HEADER_ROW_CLASS}
          getRowClassName={() => TABLE_ROW_CLASS}
          mobile={<CustomersMobileList table={table} isLoading={isLoading} />}
        />
      </div>
    </section>
  )
}
