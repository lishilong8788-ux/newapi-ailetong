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
import { CheckIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { ParamChipSpec } from '../../lib/capability'
import { getCapabilityIcon } from '../../lib/capability/icon-map'
import {
  getChipValue,
  getChipValueLabel,
  isChipModified,
  normalizeChipCustomValue,
  type ParamChipValues,
} from '../../lib/parameters/param-chip-values'

type ParamChipProps = {
  spec: ParamChipSpec
  values: ParamChipValues
  disabled?: boolean
  onChange: (id: string, value: string) => void
}

/**
 * One inline chip in the composer footer. The face always carries the current
 * value so the configuration is legible without opening anything; the popover
 * is only for changing it.
 */
export function ParamChip({
  spec,
  values,
  disabled,
  onChange,
}: ParamChipProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [customDraft, setCustomDraft] = useState('')

  const Icon = getCapabilityIcon(spec.icon)
  const currentValue = getChipValue(spec, values)
  const valueLabel = getChipValueLabel(spec, values)
  const modified = isChipModified(spec, values)

  const commitCustom = () => {
    const normalized = normalizeChipCustomValue(customDraft)
    if (normalized === null) return

    onChange(spec.id, normalized)
    setCustomDraft('')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type='button'
            // Selection is carried by border + tinted surface — the paired
            // accent tokens that survive greyscale — not by a filled primary,
            // which is reserved for the segmented pill elsewhere.
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors',
              'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
              modified
                ? 'border-primary/45 bg-accent text-accent-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/60'
            )}
          />
        }
      >
        {Icon ? (
          <Icon className='size-3.5 shrink-0 opacity-70' aria-hidden='true' />
        ) : null}
        <span>{t(spec.label)}</span>
        {valueLabel ? (
          <span
            className={cn(
              'max-w-28 truncate',
              modified ? '' : 'text-foreground/70'
            )}
          >
            {t(valueLabel)}
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent align='start' className='w-64 gap-0 p-0' side='top'>
        {spec.description ? (
          <p className='text-muted-foreground border-border/60 border-b px-3 py-2.5 text-[12px] leading-relaxed'>
            {t(spec.description)}
          </p>
        ) : null}

        <div className='hover-scrollbar max-h-64 overflow-y-auto p-1'>
          {spec.options?.map((option) => {
            const isSelected = option.value === currentValue

            return (
              <button
                key={option.value}
                type='button'
                onClick={() => {
                  onChange(spec.id, option.value)
                  setOpen(false)
                }}
                aria-pressed={isSelected}
                className={cn(
                  'hover:bg-accent/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                  isSelected && 'bg-accent text-accent-foreground font-medium'
                )}
              >
                <span className='min-w-0 flex-1'>
                  <span className='block truncate'>{t(option.label)}</span>
                  {option.hint ? (
                    <span className='text-muted-foreground/70 block truncate text-[11px] leading-tight'>
                      {t(option.hint)}
                    </span>
                  ) : null}
                </span>
                {isSelected ? (
                  <CheckIcon className='size-3.5 shrink-0' aria-hidden='true' />
                ) : null}
              </button>
            )
          })}
        </div>

        {spec.customInput ? (
          <div className='border-border/60 flex items-center gap-1.5 border-t p-2'>
            <Input
              className='h-7 text-[13px]'
              inputMode='decimal'
              onChange={(event) => setCustomDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitCustom()
                }
              }}
              placeholder={t('Custom')}
              value={customDraft}
            />
            <Button
              className='h-7 shrink-0 px-2.5'
              disabled={normalizeChipCustomValue(customDraft) === null}
              onClick={commitCustom}
              size='sm'
              variant='outline'
            >
              {t('Confirm')}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
