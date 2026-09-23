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
 * The selection language for this list, shared by the automatic-routing row and
 * the channel rows below it.
 *
 * Both are the same kind of choice — which line serves the next request — so they
 * have to look selected the same way. Duplicating the classes let them drift
 * apart once already, into a state where the pinned row and the auto row both
 * looked active.
 *
 * Deliberately not colour alone: a 3px bar on the left edge plus a tinted surface,
 * the same pair the model cards use, so the selection survives greyscale.
 */
export const SELECTION_MARKER_CLASS =
  'bg-primary absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full ' +
  'origin-center scale-y-0 transition-transform duration-[240ms] ' +
  'ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none'

/**
 * Border and surface for a row, given whether it is selected and whether this
 * viewer can select anything at all.
 *
 * A non-admin gets no hover affordance, because there is nothing to press: the
 * rows still carry real figures worth reading, and a surface that lights up under
 * the cursor promises an interaction the server would refuse.
 */
export function rowStateClass(
  isSelected: boolean,
  isClickable: boolean
): string {
  if (isSelected) return 'border-primary/45 bg-accent'
  if (isClickable) {
    return 'border-border/60 bg-card hover:border-primary/30 hover:bg-accent/40 cursor-pointer'
  }
  return 'border-border/60 bg-card'
}
