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
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatLogQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { LedgerRow } from '../types'

const PLACEHOLDER = '—'

/**
 * A quota amount, right-aligned.
 *
 * `null` renders the placeholder, never a zero: on the cost column a 0 would
 * claim the request was free when it simply was not priced.
 */
export function QuotaCell(props: {
  value: number | null
  unknownHint?: string
}) {
  if (props.value == null) {
    if (!props.unknownHint) {
      return (
        <span className='text-muted-foreground block text-right text-xs'>
          {PLACEHOLDER}
        </span>
      )
    }
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className='text-muted-foreground block cursor-help text-right text-xs'
              tabIndex={0}
            >
              {PLACEHOLDER}
            </span>
          }
        />
        <TooltipContent>{props.unknownHint}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <span className='block text-right font-mono text-xs tabular-nums'>
      {formatLogQuota(props.value)}
    </span>
  )
}

/**
 * Profit for one transaction.
 *
 * Coloured by sign so a loss is visible while scanning, and left grey at
 * exactly zero — a free model priced at zero cost is not a warning. Unpriced
 * rows explain themselves on hover instead of showing a number that would be
 * pure invention.
 */
export function ProfitCell(props: { row: LedgerRow }) {
  const { t } = useTranslation()
  const { profitQuota, grade } = props.row

  if (profitQuota == null) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className='text-muted-foreground block cursor-help text-right text-xs'
              tabIndex={0}
            >
              {PLACEHOLDER}
            </span>
          }
        />
        <TooltipContent>
          {t('No upstream cost recorded, so profit cannot be computed.')}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <span
      className={cn(
        'block text-right font-mono text-xs font-semibold tabular-nums',
        profitQuota > 0 && 'text-success',
        profitQuota < 0 && 'text-destructive',
        profitQuota === 0 && 'text-muted-foreground'
      )}
    >
      {profitQuota > 0 ? '+' : ''}
      {formatLogQuota(profitQuota)}
      {grade === 'free' ? (
        <span className='text-muted-foreground ms-1 font-normal'>
          {t('(free)')}
        </span>
      ) : null}
    </span>
  )
}

/** Margin rate, or the placeholder when revenue is zero or cost is unknown. */
export function MarginCell(props: { row: LedgerRow }) {
  const { marginRate } = props.row

  if (marginRate == null) {
    return (
      <span className='text-muted-foreground block text-right text-xs'>
        {PLACEHOLDER}
      </span>
    )
  }

  return (
    <span
      className={cn(
        'block text-right font-mono text-xs tabular-nums',
        marginRate > 0 && 'text-success',
        marginRate < 0 && 'text-destructive'
      )}
    >
      {(marginRate * 100).toFixed(1)}%
    </span>
  )
}
