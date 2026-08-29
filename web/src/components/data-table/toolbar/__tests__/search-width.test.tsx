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
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { DataTableToolbar } from '../toolbar'

type Row = { id: number }

const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: 'id', header: 'ID' }]

function ToolbarHarness(props: { searchClassName?: string }) {
  const table = useReactTable({
    data: [],
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <DataTableToolbar
      table={table}
      searchPlaceholder='按发票抬头、纳税人识别号或订单号筛选…'
      searchClassName={props.searchClassName}
    />
  )
}

describe('data table toolbar search width', () => {
  test('keeps the stock width when no override is given', () => {
    render(<ToolbarHarness />)

    expect(
      screen.getByPlaceholderText('按发票抬头、纳税人识别号或订单号筛选…')
    ).toHaveClass('sm:w-[200px]', 'lg:w-[240px]')
  })

  test('widens to the override so a long placeholder is not cut off', () => {
    // A 19-character full-width placeholder needs ~286px; the stock 240px clips
    // it, and pages carrying one pass their own width instead.
    render(<ToolbarHarness searchClassName='sm:w-[240px] lg:w-[320px]' />)

    const search = screen.getByPlaceholderText(
      '按发票抬头、纳税人识别号或订单号筛选…'
    )
    expect(search).toHaveClass('sm:w-[240px]', 'lg:w-[320px]')
    expect(search).not.toHaveClass('lg:w-[240px]')
  })
})
