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

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { cn } from '@/lib/utils'

/**
 * Theme token each variant lights its travelling border with. Only the variants
 * actually used for promotional badges are listed; anything else falls back to
 * the primary accent.
 */
const FLOW_COLOR_VAR: Partial<Record<StatusVariant, string>> = {
  warning: 'var(--warning)',
  orange: 'var(--warning)',
  red: 'var(--destructive)',
  danger: 'var(--destructive)',
  pink: 'var(--chart-5)',
  success: 'var(--success)',
  green: 'var(--success)',
}

export interface PromoBadgeProps {
  label: string
  variant: StatusVariant
  /**
   * Whether the travelling highlight runs. Off for ordinary tags, so the effect
   * stays a signal rather than ambient decoration.
   */
  flow?: boolean
  title?: string
  /**
   * The pill is sitting on the saturated masthead band rather than on a light
   * surface. `filled` tints the background at 12%, which over the band resolves to
   * roughly the band's own colour — so the variant's mid-tone label ends up on
   * blue at ~2:1. This swaps the tint for an opaque white fill, which puts the
   * badge back on the light background its palette was drawn for and restores the
   * same contrast it has on a card anywhere else in the app.
   *
   * Not a solid variant-coloured pill with a white label, which was the first
   * attempt: `--warning` is L 0.681, so white on it is 2.93:1, and of the nine
   * fills behind these variants only `--destructive` clears 4.5:1. The reference's
   * badge being solid red is the one case where that works.
   */
  onBand?: boolean
  className?: string
}

/**
 * A pill for the commercially interesting facts on a model card — the discount
 * and promotion tags — with an optional highlight that travels around its
 * border.
 *
 * The animation is deliberately scarce: a card that animates every badge reads
 * as noise, so only the fields a buyer is scanning for get it.
 */
export const PromoBadge = memo(function PromoBadge(props: PromoBadgeProps) {
  const flowColor = FLOW_COLOR_VAR[props.variant] ?? 'var(--primary)'

  const badge = (
    <StatusBadge
      label={props.label}
      variant={props.variant}
      size='lg'
      copyable={false}
      filled
      title={props.title}
      style={{
        // A complete outline at rest. Without it the travelling highlight is the
        // only thing drawing the perimeter, so the pill looks unfinished for
        // most of each cycle. Unchanged on the band: the fill there is white, so
        // the variant-tinted edge still reads as the pill's own outline.
        borderColor: `color-mix(in oklch, ${flowColor} 28%, transparent)`,
      }}
      className={cn(
        'h-[26px] border px-3 text-[13px] font-semibold',
        // Opaque, so nothing of the band shows through; the variant keeps its own
        // text colour on top.
        props.onBand && 'bg-white',
        props.className
      )}
    />
  )

  if (!props.flow) {
    return badge
  }

  return (
    <span
      className='relative inline-flex max-w-full shrink-0 rounded-4xl'
      style={{ '--flow-border-color': flowColor } as React.CSSProperties}
    >
      <span
        aria-hidden='true'
        className='flow-border pointer-events-none absolute -inset-px'
      />
      {badge}
    </span>
  )
})
