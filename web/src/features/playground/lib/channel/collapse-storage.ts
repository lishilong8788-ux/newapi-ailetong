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
 * Whether the sidebar's channel block is folded away.
 *
 * Kept out of `lib/storage`, which persists the conversation state the playground
 * cannot be reconstructed without. This is a view preference: losing it costs one
 * click, so it is written on its own key and read with no schema validation.
 *
 * Worth persisting at all because the block competes with the model list for a
 * fixed column — someone who has decided they do not want channels on screen
 * should not have to re-decide on every visit.
 */
const COLLAPSE_STORAGE_KEY = 'playground_channel_block_collapsed'

/** Defaults to expanded: the block is the only place these figures are visible. */
export function readChannelBlockCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeChannelBlockCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    /* A private-mode quota rejection must not break the toggle itself. */
  }
}
