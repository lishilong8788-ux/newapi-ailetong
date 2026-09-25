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
 * The left-hand rail: which model is being priced.
 *
 * A list, not rows of a wide table. Pricing one model means filling in up to
 * eleven numbers, and a table that tried to hold them all put three in the row
 * and hid eight behind an expander — so the row was both too wide to scan and
 * too narrow to edit in. Here the rail only answers "which model, and is it
 * priced", and the sheet beside it owns every number.
 */
import { Plus, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  countConfiguredKinds,
  formatUsdPerMillion,
  type CostPricingRow,
} from '../../../../lib'

export type ModelPriceListProps = {
  /** Field-array ids in array order; the id is the selection key, not the index. */
  rowIds: string[]
  /** Indexes to show, already filtered by the search box. */
  visibleIndexes: number[]
  rows: Array<CostPricingRow | undefined>
  selectedIndex: number | null
  onSelect: (index: number) => void
  search: string
  onSearchChange: (search: string) => void
  showSearch: boolean
  onAdd: () => void
  className?: string
}

/**
 * One rail row: the name, whether it will bill, and how much of the sheet is
 * filled in. The price shown is input/output, the two every model has.
 */
function ModelPriceListItem(props: {
  row: CostPricingRow | undefined
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const configuredCount = props.row ? countConfiguredKinds(props.row) : 0
  const perCall = props.row?.kinds.per_call.cost != null

  let priceText = t('Not priced')
  if (perCall) {
    priceText = `${formatUsdPerMillion(props.row?.kinds.per_call.sellPrice)} ${t('/ request')}`
  } else if (configuredCount > 0) {
    priceText = `${formatUsdPerMillion(props.row?.kinds.input.sellPrice)} / ${formatUsdPerMillion(props.row?.kinds.output.sellPrice)}`
  }

  return (
    <button
      type='button'
      onClick={props.onSelect}
      aria-current={props.selected ? 'true' : undefined}
      className={cn(
        'focus-visible:ring-ring flex w-full min-w-0 flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
        props.selected
          ? 'border-primary/40 bg-primary/[0.06]'
          : 'hover:bg-muted/50 border-transparent'
      )}
    >
      <div className='flex min-w-0 items-center gap-1.5'>
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            configuredCount > 0 ? 'bg-primary' : 'bg-muted-foreground/40'
          )}
          aria-hidden='true'
        />
        <span className='min-w-0 flex-1 truncate text-xs font-medium'>
          {props.row?.model || t('Untitled model')}
        </span>
        {configuredCount > 0 && (
          <Badge
            variant='secondary'
            className='shrink-0 px-1.5 py-0 text-[10px] font-normal tabular-nums'
          >
            {configuredCount}
          </Badge>
        )}
      </div>
      <span
        className={cn(
          'truncate pl-3 font-mono text-[11px] tabular-nums',
          configuredCount > 0 ? 'text-muted-foreground' : 'text-warning'
        )}
      >
        {priceText}
      </span>
    </button>
  )
}

export function ModelPriceList(props: ModelPriceListProps) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex min-h-0 flex-col', props.className)}>
      {props.showSearch && (
        <div className='border-border/60 shrink-0 border-b p-2'>
          <div className='relative'>
            <Search
              className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2'
              aria-hidden='true'
            />
            <Input
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder={t('Search models...')}
              aria-label={t('Search models...')}
              className='h-7 pr-7 pl-7 text-xs'
            />
            {props.search && (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label={t('Clear search')}
                className='absolute top-1/2 right-0.5 size-6 -translate-y-1/2'
                onClick={() => props.onSearchChange('')}
              >
                <X className='size-3.5' aria-hidden='true' />
              </Button>
            )}
          </div>
        </div>
      )}

      <div className='min-h-0 flex-1 overflow-auto overscroll-contain p-1.5'>
        {props.visibleIndexes.length === 0 ? (
          <div className='px-2 py-6 text-center'>
            <p className='text-muted-foreground text-xs'>
              {t('No models found.')}
            </p>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='mt-1 h-7 text-xs'
              onClick={() => props.onSearchChange('')}
            >
              {t('Clear search')}
            </Button>
          </div>
        ) : (
          <div className='flex flex-col gap-0.5'>
            {props.visibleIndexes.map((index) => (
              <ModelPriceListItem
                key={props.rowIds[index]}
                row={props.rows[index]}
                selected={props.selectedIndex === index}
                onSelect={() => props.onSelect(index)}
              />
            ))}
          </div>
        )}
      </div>

      <div className='border-border/60 shrink-0 border-t p-1.5'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='text-muted-foreground hover:text-foreground h-7 w-full justify-start text-xs'
          onClick={props.onAdd}
        >
          <Plus className='size-3.5' aria-hidden='true' />
          {t('Add model')}
        </Button>
      </div>
    </div>
  )
}
