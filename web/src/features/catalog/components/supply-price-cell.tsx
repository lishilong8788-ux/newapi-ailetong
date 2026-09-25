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

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatMarginRate,
  formatUsdPerMillion,
} from '@/features/channels/lib'

import { resolveSupplyPricing } from '../lib/supply-pricing'
import type { CatalogSupplyRow } from '../types'

export type SupplyPriceCellProps = {
  row: CatalogSupplyRow
  column: 'buy' | 'sell' | 'margin'
}

/**
 * One price column of a supply row.
 *
 * Input over output on two lines rather than two more columns: almost every model
 * is priced on both, and a table wide enough for six numeric columns stops being
 * readable before it stops fitting. The unit (USD / 1M tokens) is stated once in
 * the section footer, not repeated in ninety cells.
 */
export function SupplyPriceCell(props: SupplyPriceCellProps) {
  const { t } = useTranslation()
  const pricing = resolveSupplyPricing(props.row)

  if (props.column === 'margin') {
    return (
      <td className='px-4 py-2 text-right tabular-nums'>
        {pricing.marginRate == null ? (
          <span className='text-muted-foreground'>-</span>
        ) : (
          <span className='flex flex-col items-end gap-0.5 leading-tight'>
            <span className='font-mono text-[13px]'>
              {formatMarginRate(pricing.marginRate)}
            </span>
            {pricing.hasModelMarkup && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge
                      variant='outline'
                      className='cursor-help px-1 py-0 text-[13px] font-normal'
                    />
                  }
                >
                  {t('own markup')}
                </TooltipTrigger>
                <TooltipContent>
                  {t('This model overrides the channel markup.')}
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        )}
      </td>
    )
  }

  if (pricing.unpriced) {
    return (
      <td className='px-4 py-2 text-right'>
        {props.column === 'buy' ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className='text-muted-foreground cursor-help text-[13px]' />
              }
            >
              {t('not set')}
            </TooltipTrigger>
            <TooltipContent className='max-w-64'>
              {t(
                'No buy price on this channel, so it bills the platform price and reports no margin.'
              )}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className='text-muted-foreground'>-</span>
        )}
      </td>
    )
  }

  // Per-request pricing excludes the token rates entirely, so the cell shows the
  // one number that applies rather than two dashes above it.
  if (pricing.perCallBuy != null) {
    const value = props.column === 'buy' ? pricing.perCallBuy : pricing.perCallSell
    return (
      <td className='px-4 py-2 text-right tabular-nums'>
        <span className='flex flex-col items-end leading-tight'>
          <span className='font-mono text-[13px]'>{formatUsdPerMillion(value)}</span>
          <span className='text-muted-foreground/70 text-[13px]'>
            {t('/ request')}
          </span>
        </span>
      </td>
    )
  }

  const input = props.column === 'buy' ? pricing.buyInput : pricing.sellInput
  const output = props.column === 'buy' ? pricing.buyOutput : pricing.sellOutput

  return (
    <td className='px-4 py-2 text-right tabular-nums'>
      <span className='flex flex-col items-end gap-0.5 leading-tight'>
        <span className='font-mono text-[13px]'>{formatUsdPerMillion(input)}</span>
        <span className='text-muted-foreground/70 font-mono text-[13px]'>
          {formatUsdPerMillion(output)}
        </span>
      </span>
    </td>
  )
}
