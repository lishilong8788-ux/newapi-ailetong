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
 * The strip above the editor: the one markup every model inherits, and what it
 * comes to.
 *
 * Margin rides along inside the markup card rather than as a box of its own —
 * it is the same number restated (markup ÷ (1 + markup)), and a 30% markup
 * being a 23.1% margin is exactly the conversion the operator must not have to
 * do in their head.
 */
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  formatMarginRate,
  MAX_MARKUP_PERCENT,
  type ChannelFormValues,
} from '../../../../lib'

/** One-tap markups, spanning the range an operator actually reaches for. */
const MARKUP_PRESETS = [10, 20, 30, 50]

function SummaryStat(props: {
  label: string
  value: string
  hint?: string
  muted?: boolean
}) {
  return (
    <div className='border-border/60 bg-card flex min-w-0 flex-col justify-center gap-0.5 rounded-lg border px-3 py-2'>
      <span className='text-muted-foreground truncate text-[11px] font-medium'>
        {props.label}
      </span>
      <span
        className={cn(
          'font-mono text-base leading-none font-semibold tabular-nums',
          props.muted && 'text-muted-foreground'
        )}
      >
        {props.value}
      </span>
      {props.hint && (
        <span className='text-muted-foreground/75 truncate text-[11px]'>
          {props.hint}
        </span>
      )}
    </div>
  )
}

export type ChannelMarkupSummaryProps = {
  form: UseFormReturn<ChannelFormValues>
  channelMarkupPercent: number | undefined
  marginRate: number
  /** Priced rows over what the channel actually requests, e.g. `3 / 5`. */
  coverageValue: string
  coverageHint?: string
  medianDiscountText: string
  hasMedianDiscount: boolean
}

export function ChannelMarkupSummary(props: ChannelMarkupSummaryProps) {
  const { t } = useTranslation()

  return (
    <div className='grid shrink-0 gap-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]'>
      <div className='border-border/60 from-primary/[0.07] bg-card flex min-w-0 flex-col gap-2 rounded-lg border bg-linear-to-br to-transparent px-3 py-2'>
        <FormField
          control={props.form.control}
          name='cost_markup_percent'
          render={({ field }) => (
            <FormItem className='gap-1.5'>
              <div className='flex items-center gap-2'>
                <FormControl>
                  <div className='relative w-20 shrink-0'>
                    <Input
                      type='number'
                      min={0}
                      max={MAX_MARKUP_PERCENT}
                      step={1}
                      aria-label={t('Channel markup')}
                      className='h-9 pr-7 font-mono text-base font-semibold tabular-nums'
                      value={
                        typeof field.value === 'number' &&
                        Number.isFinite(field.value)
                          ? field.value
                          : ''
                      }
                      onChange={(event) => {
                        const next = event.target.valueAsNumber
                        field.onChange(Number.isFinite(next) ? next : 0)
                      }}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                    <span
                      className='text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs'
                      aria-hidden='true'
                    >
                      %
                    </span>
                  </div>
                </FormControl>
                <div className='flex min-w-0 flex-col gap-1'>
                  <span className='text-xs font-medium'>
                    {t('Channel markup')}
                  </span>
                  <div className='flex flex-wrap gap-1'>
                    {MARKUP_PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        type='button'
                        size='sm'
                        variant={
                          props.channelMarkupPercent === preset
                            ? 'secondary'
                            : 'ghost'
                        }
                        className='h-5 rounded-full px-1.5 text-[11px] font-medium tabular-nums'
                        onClick={() =>
                          props.form.setValue('cost_markup_percent', preset, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                      >
                        {preset}%
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='border-border/50 text-muted-foreground flex flex-wrap items-center gap-x-2 border-t pt-1.5 text-[11px]'>
          <span>{t('Sell price = buy price × (1 + markup)')}</span>
          <span className='text-foreground font-mono font-medium tabular-nums'>
            {t('margin {{rate}}', { rate: formatMarginRate(props.marginRate) })}
          </span>
        </div>
      </div>

      <SummaryStat
        label={t('Priced models')}
        value={props.coverageValue}
        hint={props.coverageHint}
      />
      <SummaryStat
        label={t('Median discount')}
        value={props.medianDiscountText}
        muted={!props.hasMedianDiscount}
        hint={t('vs official price')}
      />
    </div>
  )
}
