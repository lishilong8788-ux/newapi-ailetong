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
import { Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { DEFAULT_TOKEN_UNIT } from '@/features/pricing/constants'
import { getPriceComparison } from '@/features/pricing/lib/price-comparison'
import type { PricingModel } from '@/features/pricing/types'
import { formatDiscount } from '@/lib/format'

export interface CatalogPriceSummaryProps {
  model: PricingModel
  priceRate: number
  usdExchangeRate: number
}

/**
 * What the platform charges for one model, next to the vendor's list price.
 *
 * This is the **billing** price — `model_ratio` and friends scaled by the group
 * ratio — and it is the only price on this page that moves money. The per-channel
 * discounts in the supply table below are recorded for reporting and do not
 * change a customer's bill, so the two are kept visually and textually apart;
 * an operator who edits the wrong one has changed nothing.
 *
 * Rows come from the catalog's own `getPriceComparison`, so the figures here and
 * the ones a customer sees on the pricing page are produced by the same code
 * rather than by a second formatter that drifts.
 */
export function CatalogPriceSummary(props: CatalogPriceSummaryProps) {
  const { t } = useTranslation()

  const comparison = getPriceComparison(props.model, {
    tokenUnit: DEFAULT_TOKEN_UNIT,
    priceRate: props.priceRate,
    usdExchangeRate: props.usdExchangeRate,
    includeCache: true,
  })

  const headlineDiscount =
    comparison.officialDiscountRatio == null
      ? null
      : formatDiscount(comparison.officialDiscountRatio, t)

  return (
    <section className='bg-card rounded-xl border'>
      <header className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5'>
        <div className='flex min-w-0 items-center gap-2'>
          <h3 className='text-sm font-semibold'>{t('Platform price')}</h3>
          <span className='text-muted-foreground text-xs'>
            {t('This is what customers are billed.')}
          </span>
        </div>
        <Button
          variant='outline'
          size='xs'
          render={
            <Link
              to='/system-settings/billing/$section'
              params={{ section: 'model-pricing' }}
            />
          }
        >
          <Pencil />
          {t('Edit price')}
        </Button>
      </header>

      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='text-muted-foreground text-xs'>
              <th scope='col' className='px-4 py-2 text-left font-medium'>
                {t('Type')}
              </th>
              <th scope='col' className='px-4 py-2 text-right font-medium'>
                {t('Platform price')}
              </th>
              <th scope='col' className='px-4 py-2 text-right font-medium'>
                {t('Official price')}
              </th>
              <th scope='col' className='px-4 py-2 text-right font-medium'>
                {t('Discount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => {
              const discount =
                row.discountRatio == null
                  ? null
                  : formatDiscount(row.discountRatio, t)
              return (
                <tr key={row.key} className='border-t'>
                  <td className='text-muted-foreground px-4 py-2'>
                    {t(row.labelKey)}
                  </td>
                  <td className='px-4 py-2 text-right font-medium tabular-nums'>
                    {row.platform}
                  </td>
                  <td className='text-muted-foreground px-4 py-2 text-right tabular-nums'>
                    {row.official}
                  </td>
                  <td className='px-4 py-2 text-right tabular-nums'>
                    {discount ? (
                      <span className='font-medium text-orange-600 dark:text-orange-400'>
                        {discount}
                      </span>
                    ) : (
                      <span className='text-muted-foreground'>-</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {headlineDiscount && (
        <p className='text-muted-foreground border-t px-4 py-2 text-xs'>
          {t('Input tokens sell at {{discount}} of the vendor list price.', {
            discount: headlineDiscount,
          })}
        </p>
      )}
    </section>
  )
}
