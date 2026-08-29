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
import { Skeleton } from '@/components/ui/skeleton'

interface InvoiceTableSkeletonProps {
  rows?: number
  columns?: number
}

/**
 * Placeholder rows shown while a list request is in flight. The shaded first row
 * stands in for the header band so the table does not shift when data lands.
 */
export function InvoiceTableSkeleton(props: InvoiceTableSkeletonProps) {
  const rows = props.rows ?? 5
  const columns = props.columns ?? 5

  return (
    <div aria-hidden='true'>
      <div className='bg-muted/60 flex h-11 items-center gap-4 px-4'>
        {Array.from({ length: columns }, (_, columnIndex) => (
          <Skeleton
            key={`invoice-skeleton-head-${columnIndex}`}
            className='h-3.5 flex-1'
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={`invoice-skeleton-row-${rowIndex}`}
          className='flex h-15 items-center gap-4 border-b px-4 last:border-b-0'
        >
          {Array.from({ length: columns }, (__, columnIndex) => (
            <Skeleton
              key={`invoice-skeleton-cell-${rowIndex}-${columnIndex}`}
              className='h-4 flex-1'
            />
          ))}
        </div>
      ))}
    </div>
  )
}
