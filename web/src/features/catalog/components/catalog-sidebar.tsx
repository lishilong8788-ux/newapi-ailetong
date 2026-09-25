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
import { ChevronDown, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import type { CatalogItem, CatalogVendorGroup } from '../types'
import { CatalogStatusDot } from './catalog-status-dot'

/**
 * One model in the rail.
 *
 * The channel count is the second thing an operator reads after the state dot,
 * so it sits at the fixed right edge rather than after the name: model names vary
 * wildly in length, and a count that moves with the name cannot be scanned down
 * the column. `enabled/total` is shown as one figure when they agree, and as a
 * fraction when they do not — "1/3" is the shape of a supply problem.
 */
function CatalogModelRow(props: {
  item: CatalogItem
  isSelected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const { item } = props
  const hasDisabled = item.enabledChannelCount !== item.channelCount

  return (
    <button
      type='button'
      onClick={props.onSelect}
      aria-current={props.isSelected ? 'true' : undefined}
      className={cn(
        // items-start, not items-center: a wrapped two-line name would otherwise
        // drag the status dot and the count to its vertical middle, and the count
        // belongs on the first line where the eye scans for it.
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
        'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        props.isSelected
          ? 'bg-accent text-accent-foreground font-semibold'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <span className='flex h-6 shrink-0 items-center'>
        <CatalogStatusDot status={item.status} />
      </span>
      {/* The model name is the reason this rail exists, so it is the largest thing
          in it — and a step above the 14px body scale because a monospace face
          reads optically smaller than the sans text beside it at the same size.

          wrap-anywhere, not truncate: these are hyphenated strings with no spaces,
          so normal wrapping would not break them either. */}
      <span className='min-w-0 flex-1 font-mono text-[15px] leading-6 wrap-anywhere'>
        {item.modelName}
      </span>
      <span
        className='text-muted-foreground shrink-0 text-[13px] leading-6 tabular-nums'
        title={t('{{count}} channels serve this model', {
          count: item.channelCount,
        })}
      >
        {hasDisabled
          ? `${item.enabledChannelCount}/${item.channelCount}`
          : item.channelCount}
      </span>
    </button>
  )
}

export interface CatalogSidebarProps {
  vendorGroups: CatalogVendorGroup[]
  /** Total across every entry, before the search filter. */
  totalCount: number
  /** How many entries the current search matched. */
  matchedCount: number
  selectedModel: string | null
  onSelectModel: (modelName: string) => void
  search: string
  onSearchChange: (value: string) => void
  /** Opens the product editor in create mode. */
  onCreateModel: () => void
  className?: string
}

/**
 * The product rail: search at the top, a total, then one collapsible section per
 * vendor.
 *
 * Vendors rather than a flat list because a working install carries hundreds of
 * models, and the vendor is how an operator names the thing they are looking for
 * ("the DeepSeek ones"). Sections default to open so the page is readable without
 * a click on a small install, and the search filters across every section at once
 * so a name nobody remembers the vendor of is still one keystroke away.
 */
export function CatalogSidebar(props: CatalogSidebarProps) {
  const { t } = useTranslation()
  const isFiltered = props.search.trim().length > 0

  return (
    <aside
      className={cn(
        'bg-card flex min-h-0 flex-col rounded-xl border',
        // Scales with the viewport between a floor and a cap rather than sizing to
        // content: the rail's width would have to be measured through the scroll
        // viewport, which stretches to its container and so reports nothing useful
        // about the names inside it. Names that still do not fit wrap instead of
        // truncating, so the width only has to be comfortable, not exact.
        'lg:w-[clamp(18rem,22vw,26rem)]',
        props.className
      )}
    >
      <div className='shrink-0 space-y-2 border-b p-3'>
        <div className='flex items-center gap-1.5'>
          <div className='relative min-w-0 flex-1'>
            <Search
              className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2'
              aria-hidden='true'
            />
            <Input
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder={t('Search models...')}
              aria-label={t('Search models...')}
              className='h-8 pl-8 text-[13px]'
            />
          </div>
          <Button
            size='icon'
            variant='outline'
            className='size-8 shrink-0'
            aria-label={t('New product')}
            onClick={props.onCreateModel}
          >
            <Plus className='size-4' aria-hidden='true' />
          </Button>
        </div>
        <p className='text-muted-foreground px-0.5 text-[13px]'>
          {isFiltered
            ? t('{{matched}} of {{total}} products', {
                matched: props.matchedCount,
                total: props.totalCount,
              })
            : t('{{count}} products', { count: props.totalCount })}
        </p>
      </div>

      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-1 p-2'>
          {props.vendorGroups.map((group) => (
            <Collapsible key={group.vendorName} defaultOpen>
              <CollapsibleTrigger className='group text-foreground hover:bg-accent/50 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold'>
                <ChevronDown className='text-muted-foreground size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180' />
                {group.vendorIcon && (
                  <span className='shrink-0'>
                    {getLobeIcon(group.vendorIcon, 16)}
                  </span>
                )}
                {/* Vendor names are prose with spaces, so a plain wrap is enough. */}
                <span className='min-w-0 flex-1'>{group.vendorName}</span>
                <span className='text-muted-foreground shrink-0 font-normal tabular-nums'>
                  {group.items.length}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className='mt-0.5 space-y-0.5 pl-3'>
                  {group.items.map((item) => (
                    <CatalogModelRow
                      key={item.modelName}
                      item={item}
                      isSelected={props.selectedModel === item.modelName}
                      onSelect={() => props.onSelectModel(item.modelName)}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}

          {props.vendorGroups.length === 0 && (
            <p className='text-muted-foreground px-2 py-6 text-center text-[13px]'>
              {t('No models match your search.')}
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}
