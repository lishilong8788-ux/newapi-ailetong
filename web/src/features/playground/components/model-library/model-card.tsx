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
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

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

/**
 * Memoised, and it matters more here than the usual "nice to have".
 *
 * A deployment can expose several hundred models, and every one of them renders
 * a card. Without this, changing the selection re-rendered the entire list —
 * each card resolving a vendor logo through `getLobeIcon` (which builds a fresh
 * SVG tree per call) and mounting one or two `StatusBadge`es (each carrying a
 * `useCopyToClipboard` and a `useTranslation`). That put hundreds of milliseconds
 * of main-thread work behind a single click, and clicking through models faster
 * than the renders could drain made the whole page feel locked up.
 *
 * With the memo, selecting a model re-renders two cards: the one losing the
 * selection and the one gaining it. `onSelect` must stay referentially stable
 * for that to hold — see the `useCallback` at the `Playground` level.
 */
export const ModelCard = memo(function ModelCard({
  model,
  isSelected,
  activeModality,
  onSelect,
}: ModelCardProps) {
  const { t } = useTranslation()
  const capability = model.modality ? getCapability(model.modality) : undefined
  const isComingSoon = capability !== undefined && !capability.available

  return (
    <button
      type='button'
      onClick={() => onSelect(model.value)}
      aria-pressed={isSelected}
      className={cn(
        'group relative w-full rounded-xl border p-3.5 text-left',
        // Three interactions, three durations, deliberately. They used to share
        // one 200ms transition over the same properties, so clicking a card the
        // cursor was already hovering ran the hover and selection changes
        // against each other and the card spent ~200ms in a muddy in-between.
        // Press is near-instant because it acknowledges the click; hover is
        // quick; only the selection colour wash is allowed to take its time.
        // `scale`, not `transform`: Tailwind v4 compiles `scale-*` to the
        // standalone `scale` property, so naming `transform` here would leave the
        // press snapping instead of easing.
        'transition-[border-color,background-color,scale] duration-[180ms]',
        'ease-[cubic-bezier(0.16,1,0.3,1)]',
        // The press itself. Without it a click had no immediate answer at all —
        // just a slow tint — which is what made the list feel unresponsive
        // however fast the render actually was. `transform` is composited, so
        // this stays smooth with several hundred cards in the DOM.
        'active:scale-[0.985] active:duration-[70ms]',
        'focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-3',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        // Selection is carried by border + tinted surface, the same paired
        // tokens the pricing filter chips use, so it survives greyscale instead
        // of leaning on hue alone.
        isSelected
          ? 'border-primary/45 bg-accent'
          : 'border-border/60 bg-card hover:border-primary/30 hover:bg-accent/40 hover:duration-[120ms]'
      )}
    >
      {/* A position signal, not decoration. Colour alone gave the eye nothing to
          latch onto while scanning a few hundred rows — this puts a fixed mark on
          the left edge that reads at a glance and in greyscale.

          Animated with `scaleY` rather than height/opacity so it runs on the
          compositor, and with a slight overshoot so selecting a model has a
          spring to it instead of a linear wipe. */}
      <span
        aria-hidden='true'
        className={cn(
          'bg-primary absolute top-1/2 left-0 h-7 w-[3px] -translate-y-1/2 rounded-r-full',
          'origin-center transition-transform duration-[240ms]',
          'ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none',
          isSelected ? 'scale-y-100' : 'scale-y-0'
        )}
      />
      <div className='flex items-start gap-3'>
        {/* Framed icon rather than a bare glyph: vendor logos carry their own
            colours and sizes, and without a frame they read as inconsistent
            debris down the left edge of the list. */}
        <div
          className={cn(
            'bg-card flex size-9 shrink-0 items-center justify-center rounded-lg border',
            // Scales with the selection so the vendor mark lifts slightly rather
            // than only its border changing colour — the same 180ms/expo-out as
            // the card, so the two read as one movement instead of two.
            'transition-[border-color,scale] duration-[180ms]',
            'ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
            isSelected
              ? 'border-primary/35 scale-[1.04]'
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

        <div className='min-w-0 flex-1'>
          {/* Name and badges share a row as real siblings.

              The badges used to be `absolute top-3.5 right-3.5`, with this column
              carrying a hand-tuned `pr-12` to keep clear of them. 48px only covers
              one badge: on the "all" tab a coming-soon model renders two, which
              come to ~94px in Chinese and ~112px in English, so the name ran
              straight underneath them and the row became unreadable.

              Flow layout gets the fixed right edge the pinned version was for —
              `flex-1` on the name pushes the badges to the column's edge, so they
              still line up down the list — without any width to keep in sync by
              hand. `items-start` keeps them on the name's first line now that the
              name is allowed to wrap. */}
          <div className='flex items-start gap-2'>
            {/* Wraps to a second line instead of truncating.

                Model IDs here are frequently path-shaped
                (`black-forest-labs/FLUX.1-schnell`), and a vendor publishing a
                family of them shares a long prefix across every entry. Clipping
                the tail cut off the only part that differed, so two genuinely
                different models rendered as byte-identical rows — the list stopped
                being able to tell them apart at all.

                Two lines, not unlimited: the cap keeps row heights close enough to
                scan, and the `title` still carries the full ID for the rare name
                that overruns even that. Safe because this list is not virtualised. */}
            <span
              className='text-foreground line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug font-semibold [overflow-wrap:anywhere]'
              title={model.label}
            >
              {model.label}
            </span>

            <div className='mt-px flex shrink-0 items-center gap-1'>
              {/* On the "all" tab the modality is the useful fact; once the user
                  has narrowed to one, repeating it wastes the slot. */}
              {activeModality === FILTER_ALL && model.modality ? (
                <StatusBadge
                  label={t(MODALITY_LABELS[model.modality])}
                  variant={MODALITY_VARIANTS[model.modality]}
                  filled
                  copyable={false}
                  className='h-5 shrink-0 px-1.5 text-[11px]'
                />
              ) : null}
              {isComingSoon ? (
                <StatusBadge
                  label={t('Coming soon')}
                  variant='neutral'
                  copyable={false}
                  className='h-5 shrink-0 px-1.5 text-[11px]'
                />
              ) : null}
            </div>
          </div>

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
})
