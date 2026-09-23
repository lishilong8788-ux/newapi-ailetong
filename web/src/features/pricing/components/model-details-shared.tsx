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
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { MODALITY_LABEL_KEYS } from '../lib/catalog-fields'

/**
 * The one card surface every block of the details view sits on.
 *
 * The drawer's body is a tinted tray (`--surface-sunken`), which only reads as a
 * tray if something white is floating in it. The Channels tab got that for free —
 * it is nothing but cards — while Basic Info and API were built as bare sections
 * on the panel background, so those tabs resolved to one flat expanse of tint
 * with text on it: no depth, no grouping, and the tray itself misread as "the
 * panel is grey".
 *
 * Hence a single helper rather than the class trio repeated per section: card
 * white, a hairline, and the raised shadow, matching the cards on the Channels
 * tab exactly so the three tabs read as one surface language.
 *
 * `overflow-hidden` because the most common child is a table or a grid that
 * paints its own edge-to-edge rows, which would otherwise square off the
 * corners this rounds.
 */
export function DetailsCard(props: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'bg-card border-border/70 shadow-raised overflow-hidden rounded-xl border',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}

/** Uppercase rule above each block of the details view. */
export function SectionTitle(props: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h2
      className={cn(
        'text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase',
        props.className
      )}
    >
      {props.children}
    </h2>
  )
}

/**
 * Stands in for a catalog field the backend does not populate yet.
 *
 * Deliberately not an empty cell: a visible dash tells the reader the field
 * exists and is simply unset, and it keeps the spec strip's five columns at a
 * stable height whether or not any data has arrived.
 */
export function FieldPlaceholder(props: { className?: string }) {
  const { t } = useTranslation()

  return (
    <span
      className={cn('text-muted-foreground/40 font-normal', props.className)}
      title={t('Not configured yet')}
    >
      —
    </span>
  )
}

/** Localized modality names (`text` -> `Text`), rendered inline. */
export function ModalityLabels(props: { items: string[] }) {
  const { t } = useTranslation()
  if (props.items.length === 0) return null

  return (
    <span className='inline-flex items-center gap-1 align-middle'>
      {props.items.map((item) => (
        <span key={item} className='font-medium'>
          {t(MODALITY_LABEL_KEYS[item] ?? item)}
        </span>
      ))}
    </span>
  )
}

/** Neutral pill used for capability / group / endpoint / tag lists. */
export function CatalogPillList(props: { items: string[]; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap gap-1.5', props.className)}>
      {props.items.map((item) => (
        <span
          key={item}
          className='bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs font-medium'
        >
          {item}
        </span>
      ))}
    </div>
  )
}
