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
import type { SortingState } from '@tanstack/react-table'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { getLedgerPage, getLedgerSummary, type LedgerQuery } from '../api'
import {
  DEFAULT_PAGE_SIZE,
  MOBILE_PAGE_SIZE,
  PROFIT_FILTER,
  QUERY_KEY_LEDGER,
  type ProfitFilterValue,
} from '../constants'
import { toLedgerRow } from '../lib'
import type { LedgerSortBy } from '../types'
import { LedgerBackfillBanner } from './ledger-backfill-banner'
import { useLedgerColumns } from './ledger-columns'
import { LedgerExportButton } from './ledger-export-button'
import { LedgerTotalsBar } from './ledger-totals-bar'

const route = getRouteApi('/_authenticated/transaction-ledger/')

const PROFIT_FILTER_VALUES = new Set<string>(Object.values(PROFIT_FILTER))

/** Maps a table column id to the sort the backend understands. */
const SORTABLE_COLUMNS: Record<string, LedgerSortBy> = {
  createdAt: 'time',
  profitQuota: 'profit',
  costQuota: 'cost',
  revenueQuota: 'revenue',
}

function parseProfitFilter(value: unknown): ProfitFilterValue {
  const raw = Array.isArray(value) ? value[0] : value
  return PROFIT_FILTER_VALUES.has(String(raw))
    ? (String(raw) as ProfitFilterValue)
    : PROFIT_FILTER.ALL
}

export function LedgerTable(props: {
  windowStart: number
  windowEnd: number
  windowLabel: string
}) {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const columns = useLedgerColumns()
  const search = route.useSearch()
  const navigate = route.useNavigate()

  const {
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search,
    navigate,
    pagination: {
      defaultPage: 1,
      defaultPageSize: isMobile ? MOBILE_PAGE_SIZE : DEFAULT_PAGE_SIZE,
    },
    globalFilter: { enabled: false },
    columnFilters: [
      { columnId: 'profitQuota', searchKey: 'profit', type: 'array' as const },
      { columnId: 'username', searchKey: 'username', type: 'string' as const },
      { columnId: 'modelName', searchKey: 'model', type: 'string' as const },
      {
        columnId: 'channelName',
        searchKey: 'channel',
        type: 'string' as const,
      },
    ],
  })

  const filterValue = (columnId: string): string => {
    const value = columnFilters.find((filter) => filter.id === columnId)?.value
    if (Array.isArray(value)) return String(value[0] ?? '')
    return value == null ? '' : String(value)
  }

  const profitFilter = parseProfitFilter(
    columnFilters.find((filter) => filter.id === 'profitQuota')?.value
  )
  const usernameFilter = filterValue('username')
  const modelFilter = filterValue('modelName')
  const channelFilter = filterValue('channelName').trim()

  // The channel filter is an id match on the backend. A non-numeric entry would
  // silently match nothing, so it is dropped rather than sent — the reader sees
  // the unfiltered range instead of an empty table with no explanation.
  const channelId = /^\d+$/.test(channelFilter)
    ? Number(channelFilter)
    : undefined

  // Sorting lives in the URL and is applied by the database: profit is a real
  // column now, so ordering by it spans the whole range rather than reordering
  // whichever page happened to load.
  const sorting = useMemo<SortingState>(() => {
    const sortBy = search.sortBy ?? 'time'
    const columnId =
      Object.keys(SORTABLE_COLUMNS).find(
        (key) => SORTABLE_COLUMNS[key] === sortBy
      ) ?? 'createdAt'
    return [{ id: columnId, desc: search.order !== 'asc' }]
  }, [search.sortBy, search.order])

  const handleSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      const first = next[0]
      const sortBy = first ? SORTABLE_COLUMNS[first.id] : undefined
      void navigate({
        search: (prev) => ({
          ...prev,
          // An unsortable column leaves the order alone rather than resetting it
          // to time — the reader clicked a header, not a reset.
          sortBy: sortBy ?? prev.sortBy,
          order: first && !first.desc ? 'asc' : undefined,
          page: 1,
        }),
      })
    },
    [navigate, sorting]
  )

  const query: LedgerQuery = {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    startTimestamp: props.windowStart,
    endTimestamp: props.windowEnd,
    username: usernameFilter,
    modelName: modelFilter,
    channel: channelId,
    margin: profitFilter,
    sortBy: search.sortBy as LedgerSortBy | undefined,
    sortAsc: search.order === 'asc',
  }

  const listQuery = useQuery({
    queryKey: [QUERY_KEY_LEDGER, 'page', query],
    queryFn: () => getLedgerPage(query),
    placeholderData: (previousData) => previousData,
  })

  // Totals come from their own request so they describe the filtered range, not
  // the current page. Paging does not refetch them: the key deliberately omits
  // page and pageSize.
  const summaryQuery = useQuery({
    queryKey: [
      QUERY_KEY_LEDGER,
      'summary',
      { ...query, page: undefined, pageSize: undefined },
    ],
    queryFn: () => getLedgerSummary({ ...query, page: 1, pageSize: 1 }),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  })

  const failure = listQuery.error ?? summaryQuery.error
  let failureMessage = ''
  if (failure) {
    failureMessage =
      failure instanceof Error ? failure.message : t('Failed to load logs')
  }

  // In an effect, not the render body: a failed query keeps its error for as
  // long as it stays mounted, so toasting inline fires again on every unrelated
  // re-render — one backend error stacked up three toasts. The fixed id makes
  // sonner replace rather than pile up if the effect does re-run.
  useEffect(() => {
    if (!failureMessage) return
    toast.error(failureMessage, { id: 'transaction-ledger-load-error' })
  }, [failureMessage])

  const rows = useMemo(
    () => (listQuery.data?.items ?? []).map(toLedgerRow),
    [listQuery.data?.items]
  )

  const { table } = useDataTable({
    data: rows,
    columns,
    columnVisibilityStorageKey: 'transaction-ledger:column-visibility',
    pagination,
    sorting,
    onSortingChange: handleSortingChange,
    enableRowSelection: false,
    onPaginationChange,
    columnFilters,
    onColumnFiltersChange,
    // Everything the reader can reorder or narrow by is now a database column,
    // so all three stay manual — a client-side model would silently reorder or
    // re-count only the rows already fetched.
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    totalCount: listQuery.data?.total ?? 0,
    ensurePageInRange,
  })

  return (
    <div className='space-y-3'>
      <LedgerTotalsBar
        summary={summaryQuery.data}
        isLoading={summaryQuery.isPending}
        windowLabel={props.windowLabel}
      />
      <LedgerBackfillBanner
        summary={summaryQuery.data}
        windowStart={props.windowStart}
        windowEnd={props.windowEnd}
      />
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={listQuery.isPending}
        isFetching={listQuery.isFetching}
        emptyTitle={t('No transactions found')}
        emptyDescription={t(
          'No billable requests in this range. Transactions appear here once API calls are billed.'
        )}
        skeletonKeyPrefix='transaction-ledger-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Filter by username...'),
          searchKey: 'username',
          searchDebounceMs: 300,
          filters: [
            {
              columnId: 'profitQuota',
              title: t('Profit'),
              singleSelect: true,
              options: [
                { label: t('Profitable'), value: PROFIT_FILTER.PROFITABLE },
                { label: t('Loss-making'), value: PROFIT_FILTER.LOSS },
                { label: t('Not priced'), value: PROFIT_FILTER.UNPRICED },
              ],
            },
          ],
          preActions: (
            <LedgerExportButton
              query={query}
              totalRows={listQuery.data?.total ?? 0}
            />
          ),
        }}
      />
    </div>
  )
}
