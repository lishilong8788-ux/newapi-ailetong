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
import type { ColumnDef } from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { DataTableToolbar } from '../../toolbar/toolbar'
import { useDataTable } from '../use-data-table'

type Row = { id: number; name: string }

const COLUMNS: ColumnDef<Row, unknown>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
]

const ROWS: Row[] = [
  { id: 1, name: 'alpha' },
  { id: 2, name: 'beta' },
]

/** A table that filters globally only — no column filters anywhere. */
function GlobalFilterOnlyHarness(props: { globalFilter?: string }) {
  const { table } = useDataTable({
    data: ROWS,
    columns: COLUMNS,
    globalFilter: props.globalFilter,
  })

  return <DataTableToolbar table={table} searchPlaceholder='Filter rows' />
}

describe('useDataTable filter state', () => {
  test('renders the shared toolbar when the caller passes no columnFilters', () => {
    // Regression: the hook used to write `columnFilters: undefined` into
    // TanStack's `state`, which merges over its own `[]` default. Every table
    // with a toolbar but no column filters then crashed on `.length`.
    render(<GlobalFilterOnlyHarness />)

    expect(screen.getByPlaceholderText('Filter rows')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reset' })
    ).not.toBeInTheDocument()
  })

  test('offers a reset once a global filter is active', () => {
    render(<GlobalFilterOnlyHarness globalFilter='alpha' />)

    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })
})
