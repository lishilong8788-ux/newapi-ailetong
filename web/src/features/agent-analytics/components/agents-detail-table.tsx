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
import { Download, Users } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'

import {
  DORMANT_THRESHOLD_DAYS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../constants'
import { buildCsvRow, countDormant, CSV_HEADER_KEYS, toCsv } from '../lib'
import type { AgentAnalyticsRow } from '../types'
import { useAgentsDetailColumns } from './agents-detail-columns'

interface AgentsDetailTableProps {
  agents: AgentAnalyticsRow[]
  loading: boolean
  /** Fixed "now" for the whole render, so dormancy is consistent across rows. */
  nowSeconds: number
  /** Active window, restated in the export filename and the table caption. */
  windowLabel: string
}

/**
 * Per-agent detail, sortable on every column, with CSV export.
 *
 * Agent counts are in the hundreds and arrive in one payload (design doc 11.5),
 * so sorting and paging happen client-side — a round trip per sort would be
 * slower and would let the table disagree with the charts above it.
 */
export function AgentsDetailTable(props: AgentsDetailTableProps) {
  const { t } = useTranslation()
  const columns = useAgentsDetailColumns(props.nowSeconds)
  // Local rather than URL state: the route's search schema owns the window
  // params, and an unlisted key would be stripped by `validateSearch`.
  const [globalFilter, setGlobalFilter] = useState('')

  const { table } = useDataTable({
    data: props.agents,
    columns,
    globalFilter,
    onGlobalFilterChange: (updater) =>
      setGlobalFilter((previous) =>
        typeof updater === 'function' ? updater(previous) : updater
      ),
    initialSorting: [{ id: 'revenue', desc: true }],
    initialPagination: { pageIndex: 0, pageSize: 20 },
  })

  const dormantCount = useMemo(
    () => countDormant(props.agents, props.nowSeconds),
    [props.agents, props.nowSeconds]
  )

  const handleExport = useCallback(() => {
    if (props.agents.length === 0) {
      toast.error(t(ERROR_MESSAGES.EXPORT_FAILED))
      return
    }

    try {
      // Exports what the operator is looking at, in the order they sorted it,
      // rather than re-querying and risking a different window.
      const rows = table
        .getSortedRowModel()
        .rows.map((row) => buildCsvRow(row.original))
      const header = CSV_HEADER_KEYS.map((key) => t(key))
      // The BOM is what makes Excel on Windows read the file as UTF-8; without
      // it, Chinese agent names arrive as mojibake.
      const blob = new Blob([`﻿${toCsv(header, rows)}`], {
        type: 'text/csv;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `agent-analytics-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(t(SUCCESS_MESSAGES.EXPORTED))
    } catch {
      toast.error(t(ERROR_MESSAGES.EXPORT_FAILED))
    }
  }, [props.agents.length, t, table])

  const caption = dormantCount
    ? t(
        '{{agents}} agents have not earned a commission in over {{days}} days and are due for a follow-up.',
        { agents: dormantCount, days: DORMANT_THRESHOLD_DAYS }
      )
    : props.windowLabel

  return (
    <section
      className='bg-card flex flex-col overflow-hidden rounded-2xl border shadow-xs'
      aria-label={t('Agent detail')}
    >
      <div className='flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4'>
        <div className='flex flex-col gap-1'>
          <h3 className='text-sm font-semibold'>{t('Agent detail')}</h3>
          <p className='text-muted-foreground text-xs'>{caption}</p>
        </div>
        <Button
          size='sm'
          variant='outline'
          onClick={handleExport}
          disabled={props.loading || props.agents.length === 0}
        >
          <Download className='size-4' aria-hidden='true' />
          {t('Export CSV')}
        </Button>
      </div>

      <DataTablePage
        table={table}
        columns={columns}
        isLoading={props.loading}
        emptyTitle={t('No agents yet')}
        emptyDescription={t(
          'Once a user is approved as an agent and earns a commission, their performance appears here.'
        )}
        emptyIcon={<Users />}
        skeletonKeyPrefix='agent-analytics-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Filter by agent name...'),
          searchDebounceMs: 300,
        }}
        tableClassName='rounded-none border-0'
      />
    </section>
  )
}
