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
import { StatusBadge } from '@/components/status-badge'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import { getCapability } from '../../lib/capability'
import {
  FILTER_ALL,
  MODALITY_LABELS,
  MODALITY_VARIANTS,
  type ModalityFilter,
} from '../../lib/model-library/filters'
import type { ModelOption } from '../../types'

type ModelCardProps = {
  model: ModelOption
  isSelected: boolean
  /**
   * The active tab. Drives what the badge slot shows: on the "all" tab the
   * modality is the useful fact, but once the user has already narrowed to one
   * modality, repeating it wastes the slot.
   */
  activeModality: ModalityFilter
  onSelect: (modelName: string) => void
}

export function ModelCard({
  model,
  isSelected,
  activeModality,
  onSelect,
}: ModelCardProps) {
  const capability = model.modality ? getCapability(model.modality) : undefined
  const isComingSoon = capability !== undefined && !capability.available

  return (
    <button
      type='button'
      onClick={() => onSelect(model.value)}
      aria-pressed={isSelected}
      className={cn(
        'group relative w-full rounded-xl border p-3.5 text-left',
        'transition-[border-color,background-color,box-shadow] duration-200 ease-out',
        'focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-3',
        // Selection is carried by border + tinted surface, the same paired
        // tokens the pricing filter chips use, so it survives greyscale instead
        // of leaning on hue alone.
        isSelected
          ? 'border-primary/45 bg-accent shadow-sm'
          : 'border-border/60 bg-card hover:border-primary/30 hover:bg-accent/40'
      )}
    >
      {/* Badges are pinned to the corner rather than trailing the name. Inline,
          they landed at a different x for every model, so the column had no
          edge to follow — and a long name pushed them out of sight entirely. */}
      <div className='absolute top-3.5 right-3.5 flex items-center gap-1'>
        {/* On the "all" tab the modality is the useful fact; once the user has
            narrowed to one, repeating it wastes the slot. */}
        {activeModality === FILTER_ALL && model.modality ? (
          <StatusBadge
            label={MODALITY_LABELS[model.modality]}
            variant={MODALITY_VARIANTS[model.modality]}
            filled
            copyable={false}
            className='h-5 shrink-0 px-1.5 text-[11px]'
          />
        ) : null}
        {isComingSoon ? (
          <StatusBadge
            label='即将开放'
            variant='neutral'
            copyable={false}
            className='h-5 shrink-0 px-1.5 text-[11px]'
          />
        ) : null}
      </div>

      <div className='flex items-start gap-3'>
        {/* Framed icon rather than a bare glyph: vendor logos carry their own
            colours and sizes, and without a frame they read as inconsistent
            debris down the left edge of the list. */}
        <div
          className={cn(
            'bg-card flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors duration-200',
            isSelected
              ? 'border-primary/35'
              : 'border-border/80 group-hover:border-primary/30'
          )}
        >
          {model.icon ? (
            getLobeIcon(model.icon, 22)
          ) : (
            <span className='text-muted-foreground text-sm font-bold'>
              {model.label.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        {/* Reserves the pinned badges' width so a long name truncates instead of
            sliding underneath them. */}
        <div className='min-w-0 flex-1 pr-12'>
          <span
            className='text-foreground block truncate text-[13px] leading-snug font-semibold'
            title={model.label}
          >
            {model.label}
          </span>

          {model.vendorName ? (
            <p className='text-muted-foreground/70 mt-1.5 truncate text-[12px] leading-none'>
              {model.vendorName}
            </p>
          ) : null}

          {model.description ? (
            <p className='text-muted-foreground/85 mt-2 line-clamp-2 text-[12px] leading-relaxed'>
              {model.description}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  )
}
