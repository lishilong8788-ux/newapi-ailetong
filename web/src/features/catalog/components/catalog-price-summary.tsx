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
import { CircleDollarSign, Pencil, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { DEFAULT_TOKEN_UNIT } from '@/features/pricing/constants'
import { getPriceComparison } from '@/features/pricing/lib/price-comparison'
import { formatDiscount } from '@/lib/format'

import type { CatalogItem } from '../types'
import { useCatalogEditor } from './catalog-provider'

export interface CatalogPriceSummaryProps {
  item: CatalogItem
  priceRate: number
  usdExchangeRate: number
}

/**
 * The platform price for one model, next to the vendor's list price.
 *
 * This is the fallback rate: it is what a customer is billed on any channel that
 * carries no buy price of its own, which on a partially configured install is
 * most of them. Channels that *do* have one bill cost × (1 + markup) instead, and
 * those figures are in the supply table below — so the two sections are kept
 * visually and textually apart rather than merged into one price column that
 * would be right for some rows and wrong for others.
 *
 * Editing goes through the same drawer as the product's metadata, because the
 * price lives in the global ratio maps keyed by model name and that drawer is
 * what knows how to merge one model's entry without rewriting the others.
 */
export function CatalogPriceSummary(props: CatalogPriceSummaryProps) {
  const { t } = useTranslation()
  const { openEditor } = useCatalogEditor()
  const { item } = props

  const openPriceEditor = () => {
    if (item.model) {
      openEditor({ kind: 'edit-model', model: item.model })
      return
    }
    openEditor({ kind: 'create-model', modelName: item.modelName })
  }

  const editButton = (
    <Button variant='outline' size='xs' onClick={openPriceEditor}>
      <Pencil />
      {t('Edit price')}
    </Button>
  )

  if (!item.pricing) {
    return (
      <section className='bg-card rounded-xl border'>
        <header className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5'>
          <h3 className='text-sm font-semibold'>{t('Platform price')}</h3>
          {editButton}
        </header>
        <div className='px-4 py-6 text-center'>
          <CircleDollarSign
            className='text-muted-foreground/50 mx-auto size-7'
            aria-hidden='true'
          />
          <p className='text-muted-foreground mt-2 text-[13px]'>
            {t('This model is not in the sell-side catalog, so it has no price.')}
          </p>
        </div>
      </section>
    )
  }

  const comparison = getPriceComparison(item.pricing, {
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
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5'>
          <h3 className='text-sm font-semibold'>{t('Platform price')}</h3>
          <span className='text-muted-foreground text-[13px]'>
            {t('Charged on channels with no buy price of their own.')}
          </span>
        </div>
        {editButton}
      </header>

      {/* An unpriced model bills off a fallback constant, so the figures below are
          arithmetic on a sentinel rather than a price. Saying so beside them is
          the difference between "cheap" and "misconfigured". */}
      {item.pricing.price_unset && (
        <div className='border-warning/40 bg-warning/10 text-warning flex items-start gap-2 border-b px-4 py-2.5 text-[13px] leading-relaxed'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
          <span>
            {t(
              'No price was ever configured for this model, so requests bill off a fallback rate. Set one before selling it.'
            )}
          </span>
        </div>
      )}

      <div className='overflow-x-auto'>
        <table className='w-full text-[13px]'>
          <thead>
            <tr className='text-muted-foreground text-[13px]'>
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
        <p className='text-muted-foreground border-t px-4 py-2 text-[13px]'>
          {t('Input tokens sell at {{discount}} of the vendor list price.', {
            discount: headlineDiscount,
          })}
        </p>
      )}
    </section>
  )
}
