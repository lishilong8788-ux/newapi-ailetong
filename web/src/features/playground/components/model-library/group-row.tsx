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
import { CheckIcon, ChevronsUpDownIcon, LayersIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { GroupOption } from '../../types'

/**
 * The multiplier, as a face value the user can read without opening anything.
 *
 * This is the whole substance of a group. There is no membership model anywhere
 * in the backend — no tier, no entitlement, no expiry — a group is a
 * `name -> ratio` entry in `ratio_setting` that multiplies the price, and it
 * also decides which channel pool serves the request. Showing the bare group
 * key (`default`, `vip`) invited people to read it as an identity they had been
 * granted; showing the ratio next to it says "price tier" without a sentence of
 * explanation.
 *
 * `auto` is the exception the backend hands us: `controller/group.go` sets its
 * ratio to the string "自动" rather than a number, because it resolves per
 * request. Anything non-numeric renders as no suffix at all rather than as
 * `×自动`, which would read as arithmetic on a word.
 */
function formatRatio(ratio: GroupOption['ratio']): string | null {
  const numeric = typeof ratio === 'number' ? ratio : Number(ratio)

  if (!Number.isFinite(numeric)) {
    return null
  }

  // `1` and `1.0` should look alike in a column of multipliers, so one decimal
  // is the floor; `0.85` keeps its second. Trailing zeros past that are noise.
  const formatted = numeric.toFixed(2).replace(/0$/, '')

  return `×${formatted}`
}

type GroupRowProps = {
  groups: GroupOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * The billing group, sitting above the model list it governs.
 *
 * It used to be a chip in the composer footer, which inverted the causality:
 * switching group refetches the model list (the query key in
 * `use-playground-options` includes it) and drops the active model when the new
 * group cannot serve it (`shouldClearModelForGroup`). So a 32px chip in the
 * bottom-right corner could silently wipe the model picked from this column,
 * with no visible connection between the two. Here, the list reloads directly
 * underneath the control that caused it.
 *
 * Read as a pair with the filters below it, separated by a rule: this row
 * decides *which models exist*, the modality tabs and vendor filter narrow down
 * within that set.
 */
export function GroupRow({ groups, value, onChange, disabled }: GroupRowProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // A select with one option is not a choice, it is furniture. Most users are
  // in exactly one usable group (`GetUserUsableGroups` returns the operator's
  // whitelist plus the user's own group), so this row would otherwise sit at the
  // top of every sidebar offering to switch to where you already are.
  if (groups.length <= 1) {
    return null
  }

  const selected = groups.find((group) => group.value === value)
  const ratio = selected ? formatRatio(selected.ratio) : null

  return (
    <div className='flex items-center gap-2'>
      <span className='text-muted-foreground shrink-0 text-[12px]'>
        {t('Group')}
      </span>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant='outline'
              size='sm'
              disabled={disabled}
              role='combobox'
              aria-expanded={open}
              className='h-8 min-w-0 flex-1 justify-start gap-1.5 px-2.5 text-[13px] font-normal'
            />
          }
        >
          <LayersIcon className='text-muted-foreground/70 size-3.5 shrink-0' />
          <span className='min-w-0 flex-1 truncate text-left'>
            {selected?.label ?? t('Group')}
          </span>
          {/* The multiplier rides along on the closed face, tabular so a column
              of them lines up when the popover is open. */}
          {ratio ? (
            <span className='text-muted-foreground shrink-0 text-[12px] tabular-nums'>
              {ratio}
            </span>
          ) : null}
          <ChevronsUpDownIcon className='size-3 shrink-0 opacity-50' />
        </PopoverTrigger>

        <PopoverContent align='start' className='w-[17rem] p-2'>
          <div className='thin-scrollbar max-h-[18rem] space-y-0.5 overflow-y-auto pr-0.5'>
            {groups.map((group) => {
              const isSelected = group.value === value
              const groupRatio = formatRatio(group.ratio)

              return (
                <button
                  key={group.value}
                  type='button'
                  onClick={() => {
                    onChange(group.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'hover:bg-accent/60 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    isSelected && 'bg-accent text-accent-foreground'
                  )}
                >
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-baseline gap-1.5'>
                      <span
                        className={cn(
                          'truncate text-[13px]',
                          isSelected && 'font-medium'
                        )}
                      >
                        {group.label}
                      </span>
                      {groupRatio ? (
                        <span className='text-muted-foreground shrink-0 text-[11.5px] tabular-nums'>
                          {groupRatio}
                        </span>
                      ) : null}
                    </div>
                    {/* Operator-written copy. This is the only place that can
                        explain what a group actually is when its name does not
                        (a name like `vip` says nothing about which channels back
                        it), so it wraps rather than truncating. */}
                    {group.desc ? (
                      <p className='text-muted-foreground mt-0.5 text-[11.5px] leading-snug'>
                        {group.desc}
                      </p>
                    ) : null}
                  </div>
                  <span className='flex size-4 shrink-0 items-center justify-center pt-0.5'>
                    {isSelected ? <CheckIcon className='size-3.5' /> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
