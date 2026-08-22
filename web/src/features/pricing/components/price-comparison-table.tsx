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
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDiscount } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { PriceComparison } from '../lib/price-comparison'

export interface PriceComparisonTableProps {
  comparison: PriceComparison
  /** Rendered in the header of the price-type column, e.g. `平台价/M`. */
  unitLabel: string
  className?: string
}

/**
 * Compact three-column price breakdown: what the customer pays, the
 * undiscounted reference price, and the discount between them.
 *
 * When the model has no group discount (`hasDiscount === false`) the reference
 * and discount columns are dropped rather than filled with placeholders — a
 * two-column table reads as "this is the price", which is the truth.
 */
export const PriceComparisonTable = memo(function PriceComparisonTable(
  props: PriceComparisonTableProps
) {
  const { t } = useTranslation()
  const { comparison } = props

  if (comparison.specialExpression) {
    return (
      <div
        className={cn(
          'rounded-lg border border-amber-200/70 bg-amber-50/60 px-2.5 py-2 dark:border-amber-500/20 dark:bg-amber-500/10',
          props.className
        )}
      >
        <div className='text-xs font-medium text-amber-800 dark:text-amber-200'>
          {t('Special billing expression')}
        </div>
        <code className='text-muted-foreground/70 mt-0.5 line-clamp-1 block font-mono text-xs break-all'>
          {comparison.specialExpression}
        </code>
      </div>
    )
  }

  if (comparison.rows.length === 0) {
    return null
  }

  const showComparison = comparison.hasDiscount
  const discountText = showComparison
    ? formatDiscount(comparison.ratio, t)
    : null

  // A real <table>, not a grid per row: the header and the body have to share
  // one set of column widths. As separate grids the label column sized itself
  // twice — once against `Price item`, once against the shorter `Input` — so
  // every column after it started at a different x in the header than in the
  // rows, and no value sat under its own heading.
  //
  // Money columns are right-aligned, which lands each value's last digit on the
  // same edge as the right end of its heading. The discount column is centred
  // so the pill sits under the middle of `Discount`. The label column is pinned
  // to `w-0`, the auto-layout way of asking for min-content, so the card's
  // slack goes to the number columns instead of opening a hole mid-table.
  const cellY = 'py-2.5'
  // Only meaningful for the platform column, which is last when there is
  // nothing to compare against and has to carry the table's right padding.
  const platformX = showComparison ? 'pr-2 pl-2' : 'pr-3 pl-2'

  return (
    <div
      className={cn(
        // Border, header fill and row rules are all kept deliberately faint:
        // at this size three full-strength lines turn every cell into a walled
        // box. They only need to hint at the grid, not draw it.
        'border-border/50 overflow-hidden rounded-lg border',
        props.className
      )}
    >
      <table className='w-full table-auto border-collapse'>
        <thead className='bg-muted/35 text-muted-foreground/70 text-xs font-medium'>
          <tr>
            <th
              scope='col'
              className={cn(
                'w-0 pr-2 pl-3 text-left font-medium whitespace-nowrap',
                cellY
              )}
            >
              {t('Price item')}
            </th>
            <th
              scope='col'
              className={cn('text-right font-medium', platformX, cellY)}
            >
              {props.unitLabel}
            </th>
            {showComparison && (
              <>
                <th
                  scope='col'
                  className={cn('px-2 text-right font-medium', cellY)}
                >
                  {t('List price')}
                </th>
                <th
                  scope='col'
                  className={cn('pr-3 pl-2 text-center font-medium', cellY)}
                >
                  {t('Discount')}
                </th>
              </>
            )}
          </tr>
        </thead>

        <tbody>
          {comparison.rows.map((row, index) => (
            <tr
              key={row.key}
              className={index > 0 ? 'border-border/30 border-t' : undefined}
            >
              <th
                scope='row'
                className={cn(
                  'text-foreground w-0 pr-2 pl-3 text-left text-[13px] font-bold whitespace-nowrap',
                  cellY
                )}
              >
                {t(row.labelKey)}
              </th>
              {/* The price the customer actually pays is the card's visual
                  anchor, so it carries the accent colour and the most weight. */}
              <td
                className={cn(
                  'text-right font-mono text-[15px] font-bold text-rose-600 tabular-nums dark:text-rose-400',
                  platformX,
                  cellY
                )}
              >
                {row.platform}
              </td>
              {showComparison && (
                <>
                  <td
                    className={cn(
                      'text-muted-foreground/45 px-2 text-right font-mono text-[13px] tabular-nums line-through',
                      cellY
                    )}
                  >
                    {row.list}
                  </td>
                  <td className={cn('pr-3 pl-2 text-center', cellY)}>
                    <span className='inline-flex items-center rounded-md bg-orange-500/12 px-2 py-0.5 text-[13px] font-semibold text-orange-600 tabular-nums dark:bg-orange-400/15 dark:text-orange-400'>
                      {discountText}
                    </span>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})
