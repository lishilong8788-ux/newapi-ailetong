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
/**
 * The buy-price sheet for one (channel, model) pair.
 *
 * A trimmed sibling of the channel drawer's `ModelPriceSheet`: same arithmetic
 * (`buildCostPricingRow`), same input component, same units. What it drops is
 * everything that only makes sense when a whole channel is on screen — the model
 * picker, the delete button, the row-vs-channel markup override — because this
 * panel is opened against one model the operator already chose, and the markup
 * shown here is the one that model prices at.
 */
import { useMemo } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { BuyPriceInput } from '@/features/channels/components/drawers/sections/pricing/cost-pricing-fields'
import { KIND_TEXT } from '@/features/channels/components/drawers/sections/pricing/cost-pricing-text'
import {
  buildCostPricingRow,
  COST_PRICING_GROUPS,
  COST_PRICING_KINDS,
  formatMarginRate,
  formatUsdPerMillion,
  MAX_MARKUP_PERCENT,
  type ChannelFormValues,
  type CostPricingKind,
  type CostPricingOfficialPrice,
} from '@/features/channels/lib'
import { formatDiscount } from '@/lib/format'
import { cn } from '@/lib/utils'

export type ChannelCostPanelProps = {
  form: UseFormReturn<ChannelFormValues>
  /** Field-array index of the row being edited — this is the form path. */
  index: number
  officialPrice?: CostPricingOfficialPrice
  isLoadingOfficialPrice: boolean
}

/** Shared column geometry, so the digits line up down the sheet. */
const GRID =
  'grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-center gap-x-2.5 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6.5rem]'

export function ChannelCostPanel(props: ChannelCostPanelProps) {
  const { t } = useTranslation()

  // `useWatch`, not `form.watch`: the latter returns the same array instance
  // after a nested edit, so a memo keyed on it never recomputes and the derived
  // sell column freezes while the buy box visibly changes.
  const costModels = useWatch({
    control: props.form.control,
    name: 'cost_models',
  })
  const channelMarkupPercent = useWatch({
    control: props.form.control,
    name: 'cost_markup_percent',
  })
  const rowMarkupPercent = useWatch({
    control: props.form.control,
    name: `cost_models.${props.index}.markup_percent`,
  })

  const row = useMemo(() => {
    const values = costModels?.[props.index]
    const costs = {} as Record<CostPricingKind, number | undefined>
    for (const kind of COST_PRICING_KINDS) {
      costs[kind.key] = values?.[kind.key]
    }
    return buildCostPricingRow(
      {
        model: values?.model,
        markupPercent: values?.markup_percent,
        costs,
      },
      channelMarkupPercent,
      props.officialPrice
    )
  }, [costModels, props.index, channelMarkupPercent, props.officialPrice])

  // Per-request pricing excludes every per-token kind, so the two are shown as
  // alternatives rather than as twelve boxes of which one silently wins.
  const perCallMode = row.kinds.per_call.cost != null

  const renderDiscount = (fraction: number | null): string => {
    if (fraction == null || !Number.isFinite(fraction)) return '-'
    return formatDiscount(fraction, t) ?? `${Number(fraction.toFixed(2))}x`
  }

  const clearPerCall = () => {
    // `update` drops the value and `unregister` drops what RHF cached for the
    // box that just unmounted; without the second call the old number comes
    // back the next time the box renders.
    props.form.setValue(`cost_models.${props.index}.per_call`, undefined, {
      shouldDirty: true,
    })
    props.form.unregister(`cost_models.${props.index}.per_call`, {
      keepDirty: true,
    })
  }

  return (
    <div className='space-y-3'>
      {/* ── Markup: the one number that turns every buy price into a sell price ── */}
      <div className='border-border/60 bg-muted/25 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5'>
        <div className='min-w-0 flex-1'>
          <span className='text-[13px] font-medium'>{t('Markup')}</span>
          <p className='text-muted-foreground/80 text-[13px]'>
            {t('Sell price is the buy price plus this markup.')}
          </p>
        </div>
        <FormField
          control={props.form.control}
          name={`cost_models.${props.index}.markup_percent`}
          render={({ field }) => (
            <FormItem className='w-24'>
              <FormControl>
                <div className='relative'>
                  <Input
                    type='number'
                    min={0}
                    max={MAX_MARKUP_PERCENT}
                    step={1}
                    placeholder={String(channelMarkupPercent ?? 0)}
                    aria-label={t('Markup')}
                    className='h-9 pr-5 pl-2 text-right font-mono text-[13px] tabular-nums'
                    value={
                      typeof field.value === 'number' &&
                      Number.isFinite(field.value)
                        ? field.value
                        : ''
                    }
                    onChange={(event) => {
                      const next = event.target.valueAsNumber
                      // Blanking falls back to the channel markup rather than
                      // pinning the last number typed.
                      field.onChange(Number.isFinite(next) ? next : undefined)
                    }}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                  <span
                    className='text-muted-foreground/70 pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[13px]'
                    aria-hidden='true'
                  >
                    %
                  </span>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='flex shrink-0 flex-col items-end leading-tight'>
          <span className='font-mono text-[13px] tabular-nums'>
            {formatMarginRate(row.marginRate)}
          </span>
          <span className='text-muted-foreground/70 text-[13px]'>
            {t('Margin')}
          </span>
        </div>
      </div>

      {rowMarkupPercent == null && (
        <p className='text-muted-foreground text-[13px]'>
          {t('Following the channel markup of {{percent}}%.', {
            percent: channelMarkupPercent ?? 0,
          })}
        </p>
      )}

      {perCallMode ? (
        <div className='space-y-2'>
          <div className='border-border/60 bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5'>
            <div className='min-w-0 flex-1'>
              <span className='text-[13px] font-medium'>
                {t(KIND_TEXT.per_call.label)}
              </span>
              <p className='text-muted-foreground/80 text-[13px]'>
                {t(KIND_TEXT.per_call.hint)}
              </p>
            </div>
            <BuyPriceInput
              form={props.form}
              index={props.index}
              kind='per_call'
              label={t('Buy price ({{kind}})', {
                kind: t(KIND_TEXT.per_call.label),
              })}
              placeholder={KIND_TEXT.per_call.placeholder}
              className='w-24'
            />
            <div className='flex shrink-0 flex-col items-end leading-tight'>
              <span className='font-mono text-[13px] tabular-nums'>
                {formatUsdPerMillion(row.kinds.per_call.sellPrice)}
              </span>
              <span className='text-muted-foreground/70 text-[13px]'>
                {t('$ / request')}
              </span>
            </div>
          </div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 px-2 text-[13px]'
            onClick={clearPerCall}
          >
            {t('Switch to per-token pricing')}
          </Button>
        </div>
      ) : (
        <div className='border-border/60 bg-card max-h-[22rem] overflow-auto overscroll-contain rounded-lg border px-1 py-2'>
          <div
            className={cn(
              GRID,
              'text-muted-foreground bg-card sticky top-0 z-10 px-2.5 pb-1 text-[13px] font-medium'
            )}
          >
            <span>{t('Dimension')}</span>
            <span className='text-right'>{t('Buy')}</span>
            <span className='text-right'>{t('Sell')}</span>
            <span className='hidden text-right sm:block'>
              {t('vs official')}
            </span>
          </div>

          {COST_PRICING_GROUPS.map((group) => (
            <div key={group.id} className='flex flex-col'>
              <span className='text-muted-foreground/70 px-2.5 pt-1.5 pb-0.5 text-[13px]'>
                {t(group.label)}
              </span>
              {group.keys.map((kind) => {
                const dimension = row.kinds[kind]
                const costOnly =
                  COST_PRICING_KINDS.find((entry) => entry.key === kind)
                    ?.reach === 'cost_only'
                const discount = dimension.discountFraction

                return (
                  <div
                    key={kind}
                    className={cn(
                      GRID,
                      'hover:bg-muted/40 rounded-md px-2.5 py-1.5'
                    )}
                  >
                    <div className='flex min-w-0 items-center gap-1.5'>
                      <span className='shrink-0 text-[13px] font-medium'>
                        {t(KIND_TEXT[kind].label)}
                      </span>
                      <span className='text-muted-foreground/75 hidden wrap-anywhere text-[13px] lg:inline'>
                        {costOnly
                          ? t('Bills at the output rate; cost report only.')
                          : t(KIND_TEXT[kind].hint)}
                      </span>
                    </div>

                    <BuyPriceInput
                      form={props.form}
                      index={props.index}
                      kind={kind}
                      label={t('Buy price ({{kind}})', {
                        kind: t(KIND_TEXT[kind].label),
                      })}
                      placeholder={KIND_TEXT[kind].placeholder}
                    />

                    <span
                      className={cn(
                        'truncate text-right font-mono text-[13px] tabular-nums',
                        (costOnly || dimension.sellPrice == null) &&
                          'text-muted-foreground'
                      )}
                    >
                      {costOnly ? '—' : formatUsdPerMillion(dimension.sellPrice)}
                    </span>

                    <div className='hidden min-w-0 flex-col items-end leading-tight sm:flex'>
                      {props.isLoadingOfficialPrice ? (
                        <Skeleton className='h-3.5 w-12' />
                      ) : (
                        <>
                          <span
                            className={cn(
                              'truncate text-right font-mono text-[13px] tabular-nums',
                              discount == null && 'text-muted-foreground',
                              (discount ?? 0) > 1 && 'text-warning'
                            )}
                          >
                            {renderDiscount(discount)}
                          </span>
                          <span className='text-muted-foreground/70 font-mono text-[13px] tabular-nums'>
                            {formatUsdPerMillion(dimension.officialPrice)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          <div className='flex flex-wrap items-center justify-between gap-2 px-2.5 pt-2'>
            <p className='text-muted-foreground/75 text-[13px] leading-relaxed'>
              {t('USD / 1M tokens. Blank dimensions are not charged.')}
            </p>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='text-muted-foreground h-6 px-1.5 text-[13px]'
              onClick={() =>
                // 0 is a real per-request price ("free call"), and it is also the
                // only way to enter the mode: the backend takes the per_call
                // branch on the key's presence, not on its value.
                props.form.setValue(`cost_models.${props.index}.per_call`, 0, {
                  shouldDirty: true,
                })
              }
            >
              {t('Price per request instead')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
