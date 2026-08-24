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
import { Check, ChevronDown } from 'lucide-react'

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
  const selected = options.find((option) => option.value === value)
  const label = selected?.label ?? '全部厂商'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className={cn(
            'h-8 shrink-0 gap-1.5 px-2.5 text-[13px] font-normal',
            value !== FILTER_ALL &&
              'border-primary/45 bg-accent text-accent-foreground font-medium'
          )}
        >
          {value !== FILTER_ALL && selected?.icon
            ? getLobeIcon(selected.icon, 14)
            : null}
          <span className='max-w-24 truncate'>{label}</span>
          <ChevronDown className='size-3 opacity-50' />
        </Button>
      </PopoverTrigger>

      <PopoverContent align='start' className='w-56 p-1'>
        <div className='hover-scrollbar max-h-72 overflow-y-auto'>
          {options.map((option) => (
            <button
              key={option.value}
              type='button'
              onClick={() => onChange(option.value)}
              className={cn(
                'hover:bg-accent/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                option.value === value &&
                  'bg-accent text-accent-foreground font-medium'
              )}
            >
              {option.value === FILTER_ALL ? (
                <span className='size-3.5 shrink-0' />
              ) : (
                <span className='shrink-0'>{getLobeIcon(option.icon, 14)}</span>
              )}
              <span className='flex-1 truncate'>{option.label}</span>
              <span
                className={cn(
                  'shrink-0 rounded px-1 text-[11px]',
                  option.value === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-foreground/8 text-muted-foreground'
                )}
              >
                {option.count}
              </span>
              {option.value === value ? (
                <Check className='size-3 shrink-0' />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
