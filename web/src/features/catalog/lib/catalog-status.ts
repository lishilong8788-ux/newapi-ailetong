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
import type { CatalogStatus } from '../types'

/**
 * Presentation for each catalog state, in one place so the left rail's dot, the
 * header chip and the summary counters cannot drift apart.
 *
 * `dotClass` is a background colour and `textClass` a foreground one, both from
 * the theme's semantic palette rather than raw hex, so the page follows dark
 * mode. Every state also carries a distinct `labelKey`: colour alone would make
 * `blocked` and `out_of_stock` indistinguishable to a reader who cannot separate
 * amber from grey.
 */
export const CATALOG_STATUS_META: Record<
  CatalogStatus,
  { labelKey: string; descriptionKey: string; dotClass: string; textClass: string }
> = {
  on_sale: {
    labelKey: 'On sale',
    descriptionKey: 'Reachable and priced.',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  unpriced: {
    labelKey: 'Unpriced',
    descriptionKey:
      'On sale but no price was ever configured, so requests bill off a fallback rate.',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  blocked: {
    labelKey: 'Not sellable',
    descriptionKey:
      'An enabled channel serves it, but it never reaches the catalog — check the model status and its abilities.',
    dotClass: 'bg-rose-500',
    textClass: 'text-rose-600 dark:text-rose-400',
  },
  out_of_stock: {
    labelKey: 'Out of stock',
    descriptionKey: 'Configured on a channel, but no enabled channel carries it.',
    dotClass: 'bg-muted-foreground/40',
    textClass: 'text-muted-foreground',
  },
}

/** Order the status filter chips and the header counters share. */
export const CATALOG_STATUS_ORDER: readonly CatalogStatus[] = [
  'on_sale',
  'unpriced',
  'blocked',
  'out_of_stock',
]
