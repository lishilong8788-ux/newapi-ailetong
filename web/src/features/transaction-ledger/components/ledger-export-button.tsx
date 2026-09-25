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
import { Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { getLedgerPage, type LedgerQuery } from '../api'
import { EXPORT_PAGE_SIZE, MAX_EXPORT_ROWS } from '../constants'
import { toLedgerCsv, toLedgerRow } from '../lib'
import type { LedgerRow } from '../types'

/**
 * Exports the filtered range as CSV.
 *
 * Walks the query page by page rather than dumping the rows already on screen:
 * the totals bar above describes the whole filtered range, so an export scoped
 * to the visible page would hand the reader a file that contradicts the number
 * they just read. Capped at MAX_EXPORT_ROWS so one click cannot turn into an
 * unbounded scan; when the cap bites, the download still happens and the toast
 * says what it covers.
 */
export function LedgerExportButton(props: {
  query: LedgerQuery
  totalRows: number
}) {
  const { t } = useTranslation()
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (props.totalRows === 0) {
      toast.error(t('Nothing to export'))
      return
    }

    setIsExporting(true)
    try {
      const rows: LedgerRow[] = []
      for (let page = 1; rows.length < MAX_EXPORT_ROWS; page += 1) {
        const result = await getLedgerPage({
          ...props.query,
          page,
          pageSize: EXPORT_PAGE_SIZE,
        })
        rows.push(...result.items.map(toLedgerRow))
        if (result.items.length < EXPORT_PAGE_SIZE) break
      }
      const exported = rows.slice(0, MAX_EXPORT_ROWS)

      // BOM first: without it Excel reads the UTF-8 bytes as the local codepage
      // and mangles non-ASCII channel and model names.
      const blob = new Blob(['﻿', toLedgerCsv(exported)], {
        type: 'text/csv;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)

      if (props.totalRows > exported.length) {
        toast.warning(
          t('Exported the first {{count}} of {{total}} transactions', {
            count: exported.length,
            total: props.totalRows,
          })
        )
      } else {
        toast.success(
          t('Exported {{count}} transactions', { count: exported.length })
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Export failed'))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Button
      variant='outline'
      size='sm'
      onClick={() => void handleExport()}
      className='h-8'
      disabled={props.totalRows === 0 || isExporting}
    >
      <Download aria-hidden='true' />
      {isExporting ? t('Exporting...') : t('Export CSV')}
    </Button>
  )
}
