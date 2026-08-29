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
import { Check, ChevronDown, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  FILTER_ALL,
  type VendorFilterOption,
} from '../../lib/model-library/filters'

type VendorFilterProps = {
  options: VendorFilterOption[]
  value: string
  onChange: (value: string) => void
}

export function VendorFilter({ options, value, onChange }: VendorFilterProps) {
  const { t } = useTranslation()
  const selected = options.find((option) => option.value === value)

  /**
   * Only the "all vendors" sentinel carries a translatable label; every other
   * option is a vendor name straight from the backend and has to render as-is.
   */
  const resolveLabel = (option: VendorFilterOption) =>
    option.value === FILTER_ALL ? t(option.label) : option.label

  const label = selected ? resolveLabel(selected) : t('All vendors')

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant='outline'
            size='sm'
            className={cn(
              'h-8 shrink-0 gap-1.5 px-2.5 text-[13px] font-normal',
              value !== FILTER_ALL &&
                'border-primary/45 bg-accent text-accent-foreground font-medium'
            )}
          />
        }
      >
        {value !== FILTER_ALL && selected?.icon
          ? getLobeIcon(selected.icon, 14)
          : null}
        <span className='max-w-24 truncate'>{label}</span>
        <ChevronDown className='size-3 opacity-50' />
      </PopoverTrigger>

      <PopoverContent align='start' className='w-72 p-2'>
        <div className='thin-scrollbar max-h-[22rem] space-y-0.5 overflow-y-auto pr-0.5'>
          {options.map((option) => {
            const isSelected = option.value === value

            return (
              <button
                key={option.value}
                type='button'
                onClick={() => onChange(option.value)}
                className={cn(
                  'hover:bg-accent/60 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                  isSelected && 'bg-accent text-accent-foreground font-medium'
                )}
              >
                {/* Fixed 20px icon slot on every row — vendor logo, or a Layers
                    glyph for the "all" sentinel — so labels line up and the row
                    height stays even whether or not a mark is present. */}
                <span className='flex size-5 shrink-0 items-center justify-center'>
                  {option.value === FILTER_ALL ? (
                    <Layers className='text-muted-foreground/70 size-4' />
                  ) : (
                    getLobeIcon(option.icon, 18)
                  )}
                </span>
                <span className='min-w-0 flex-1 truncate'>
                  {resolveLabel(option)}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
                    isSelected
                      ? 'text-accent-foreground/80'
                      : 'bg-foreground/8 text-muted-foreground'
                  )}
                >
                  {option.count}
                </span>
                {/* Reserved check column, so selecting a row does not nudge the
                    count badge sideways. */}
                <span className='flex size-4 shrink-0 items-center justify-center'>
                  {isSelected ? <Check className='size-3.5' /> : null}
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
