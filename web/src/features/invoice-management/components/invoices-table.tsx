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
import { ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  DataTableToolbar,
  useDataTable,
} from '@/components/data-table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  INVOICE_TABLE_CLASS,
  INVOICE_TABLE_HEADER_ROW_CLASS,
  INVOICE_TABLE_ROW_CLASS,
} from '@/features/invoices/components/invoice-table-chrome'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { cn } from '@/lib/utils'

import { listInvoiceRequests } from '../api'
import {
  ERROR_MESSAGES,
  INVOICE_STATUS_TAB_ALL,
  INVOICE_STATUS_TABS,
  INVOICE_STATUS_TAB_DEFAULT,
  INVOICE_STATUS_TAB_LABEL_KEYS,
} from '../constants'
import { useInvoicesColumns } from './invoices-columns'
import { InvoicesMobileList } from './invoices-mobile-list'
import { useInvoices } from './invoices-provider'

const route = getRouteApi('/_authenticated/invoice-management/')

export function InvoicesTable() {
  const { t } = useTranslation()
  const columns = useInvoicesColumns()
  const { refreshTrigger } = useInvoices()
  const isMobile = useMediaQuery('(max-width: 640px)')

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
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'status', type: 'string' },
    ],
  })

  // The tab strip and the URL share one source of truth: the status column
  // filter. Landing on the page with no `status` in the URL opens the queue that
  // actually needs work, so an absent filter means "Pending" — the "All" tab
  // writes its sentinel explicitly and is the one tab that sends no status to
  // the API.
  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string
      | undefined) ?? ''
  const activeTab = statusFilter || INVOICE_STATUS_TAB_DEFAULT
  const requestStatus = activeTab === INVOICE_STATUS_TAB_ALL ? '' : activeTab

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'invoice-requests',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      requestStatus,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await listInvoiceRequests({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        status: requestStatus,
        keyword: globalFilter,
      })

      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.LOAD_FAILED))
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

  // Layout mirrors the user-facing invoices page: one card, the tab strip and
  // the toolbar sharing its header row, and the table running flush to the card
  // edges below them.
  return (
    <Tabs
      className='bg-card flex h-full min-h-0 flex-col gap-0 overflow-hidden rounded-xl border'
      value={activeTab}
      onValueChange={(value) => {
        // Every tab, "All" included, writes its own value: dropping the param
        // instead would read back as the default Pending tab.
        onColumnFiltersChange([{ id: 'status', value }])
      }}
    >
      <div className='flex shrink-0 flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4'>
        <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto sm:group-data-horizontal/tabs:h-9'>
          {INVOICE_STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} className='px-3'>
              {t(INVOICE_STATUS_TAB_LABEL_KEYS[tab])}
            </TabsTrigger>
          ))}
        </TabsList>

        <DataTableToolbar
          table={table}
          searchPlaceholder={t(
            'Filter by invoice title, tax number or order number...'
          )}
          searchDebounceMs={500}
          // The zh placeholder is 19 full-width characters — about 286px with
          // padding — so the stock 240px cuts it off mid-word.
          searchClassName='sm:w-[240px] lg:w-[320px]'
          className='sm:flex-nowrap'
        />
      </div>

      <div className='min-h-0 flex-1'>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
          emptyTitle={t('No Invoice Requests Found')}
          emptyDescription={t('No invoice requests match the current filters.')}
          emptyIcon={<ReceiptText />}
          skeletonKeyPrefix='invoice-requests-skeleton'
          applyHeaderSize
          toolbarProps={null}
          // The card already draws the frame, so the table drops its own border
          // and widens its cells to clear the card edge.
          tableClassName={cn('rounded-none border-0', INVOICE_TABLE_CLASS)}
          tableHeaderClassName={INVOICE_TABLE_HEADER_ROW_CLASS}
          getRowClassName={() => INVOICE_TABLE_ROW_CLASS}
          pinnedColumns={[
            {
              columnId: 'actions',
              side: 'right',
              // The pinned cell paints its own opaque background, so it needs
              // the row's hover tint restated or the last column stays pale.
              cellClassName: 'group-hover:[background-color:var(--muted)]',
            },
          ]}
          mobile={<InvoicesMobileList table={table} isLoading={isLoading} />}
        />
      </div>
    </Tabs>
  )
}
