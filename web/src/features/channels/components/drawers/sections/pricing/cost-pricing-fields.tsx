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
import type { UseFormReturn } from 'react-hook-form'

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import type { ChannelFormValues, CostPricingKind } from '../../../../lib'

/**
 * One buy-price box, bound to one token kind of one row.
 *
 * Blanking the box clears the key rather than storing 0: an unset cache price
 * lets the backend derive one from the official cache ratio, while a stored 0
 * declares cached reads free.
 */
export function BuyPriceInput(props: {
  form: UseFormReturn<ChannelFormValues>
  index: number
  kind: CostPricingKind
  label: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <FormField
      control={props.form.control}
      name={`cost_models.${props.index}.${props.kind}`}
      render={({ field }) => (
        <FormItem className='min-w-0'>
          <FormControl>
            <Input
              type='number'
              min={0}
              step={0.01}
              placeholder={props.placeholder ?? '0.00'}
              aria-label={props.label}
              disabled={props.disabled}
              className={cn(
                // A price is the one figure on these forms that is read digit by
                // digit, so it sits at body size rather than in the annotation
                // tier the labels around it use.
                'h-9 px-2 text-right font-mono text-sm tabular-nums',
                props.className
              )}
              value={
                typeof field.value === 'number' && Number.isFinite(field.value)
                  ? field.value
                  : ''
              }
              onChange={(event) => {
                const next = event.target.valueAsNumber
                field.onChange(Number.isFinite(next) ? next : undefined)
              }}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
