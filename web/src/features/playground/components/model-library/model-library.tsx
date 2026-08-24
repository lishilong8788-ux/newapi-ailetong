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
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import {
  INITIAL_FILTER_STATE,
  MODALITY_TABS,
  type ModalityFilter,
  buildVendorOptions,
  countByModality,
  filterModels,
} from '../../lib/model-library/filters'
import type { ModelOption } from '../../types'
import { ModelCard } from './model-card'
import { VendorFilter } from './vendor-filter'

type ModelLibraryProps = {
  models: ModelOption[]
  selectedModel: string
  isLoading: boolean
  onSelectModel: (modelName: string) => void
}

/**
 * The playground's primary entry point: people arrive knowing the capability
 * they want ("write code", "make a picture"), so the model comes first and
 * everything downstream is derived from it.
 */
export function ModelLibrary({
  models,
  selectedModel,
  isLoading,
  onSelectModel,
}: ModelLibraryProps) {
  const [filters, setFilters] = useState(INITIAL_FILTER_STATE)

  const visibleModels = useMemo(
    () => filterModels(models, filters),
    [models, filters]
  )
  const modalityCounts = useMemo(
    () => countByModality(models, filters),
    [models, filters]
  )
  const vendorOptions = useMemo(
    () => buildVendorOptions(models, filters),
    [models, filters]
  )

  return (
    <div className='bg-canvas flex h-full min-h-0 w-full flex-col'>
      <div className='border-border/60 space-y-3 border-b p-3.5'>
        <div className='bg-muted/50 flex items-center gap-0.5 rounded-full p-0.5'>
          {MODALITY_TABS.map((tab) => (
            <ModalityTab
              key={tab.value}
              label={tab.label}
              count={modalityCounts[tab.value]}
              isActive={filters.modality === tab.value}
              onClick={() =>
                setFilters((prev) => ({ ...prev, modality: tab.value }))
              }
            />
          ))}
        </div>

        <div className='flex items-center gap-2'>
          <VendorFilter
            options={vendorOptions}
            value={filters.vendor}
            onChange={(vendor) => setFilters((prev) => ({ ...prev, vendor }))}
          />
          <div className='relative flex-1'>
            <Search className='text-muted-foreground/60 pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, search: event.target.value }))
              }
              placeholder='搜索模型'
              className='h-8 pl-8 text-[13px]'
            />
          </div>
        </div>
      </div>

      {/* A native scroll container with `hover-scrollbar`, matching the pricing
          sidebar. `ScrollArea` renders a permanent 10px bar and does not expose
          its scrollbar through props, so slimming it would mean editing a
          component shared by dozens of dialogs. */}
      <div className='hover-scrollbar min-h-0 flex-1 overflow-y-auto'>
        <div className='space-y-2 p-2.5'>
          <ModelList
            models={visibleModels}
            totalCount={models.length}
            selectedModel={selectedModel}
            activeModality={filters.modality}
            isLoading={isLoading}
            onSelectModel={onSelectModel}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * A segmented control, not a row of bordered chips.
 *
 * These tabs switch one view between five states, so they read best as one
 * connected strip: an inactive tab is bare text and only the active one takes a
 * filled pill. Giving each its own border turned five buttons into five boxes
 * competing for attention — and the extra width wrapped the row onto two lines.
 *
 * `bg-primary` + `primary-foreground` is safe here (unlike `text-primary` on a
 * plain surface) because the pair is designed to be used together.
 */
function ModalityTab(props: {
  label: string
  count: number
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={props.onClick}
      aria-pressed={props.isActive}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] transition-colors',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        props.isActive
          ? 'bg-primary text-primary-foreground font-semibold'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
      )}
    >
      <span>{props.label}</span>
      {/* Count only on the active tab. Showing it on all of them is what forced
          the row to wrap, and an inactive tab's count is a number the user has
          not asked for yet. */}
      {props.isActive && props.count > 0 ? (
        <span className='text-[11px] font-normal opacity-75'>
          {props.count}
        </span>
      ) : null}
    </button>
  )
}

type ModelListProps = {
  models: ModelOption[]
  /** Distinguishes "nothing available" from "nothing matched the filters". */
  totalCount: number
  selectedModel: string
  activeModality: ModalityFilter
  isLoading: boolean
  onSelectModel: (modelName: string) => void
}

function ModelList({
  models,
  totalCount,
  selectedModel,
  activeModality,
  isLoading,
  onSelectModel,
}: ModelListProps) {
  if (isLoading) {
    return Array.from({ length: 6 }, (_, index) => (
      <Skeleton key={index} className='h-16 w-full rounded-lg' />
    ))
  }

  if (models.length === 0) {
    return (
      <p className='text-muted-foreground px-2 py-8 text-center text-xs'>
        {totalCount === 0 ? '暂无可用模型' : '没有匹配的模型'}
      </p>
    )
  }

  return models.map((model) => (
    <ModelCard
      key={model.value}
      model={model}
      isSelected={model.value === selectedModel}
      activeModality={activeModality}
      onSelect={onSelectModel}
    />
  ))
}
