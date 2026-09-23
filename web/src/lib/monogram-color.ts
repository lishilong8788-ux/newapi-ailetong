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
 * Deterministic colour for monogram avatars.
 *
 * Used when no brand icon exists for a name. A single shared grey makes every
 * such entry look identical in a list, which defeats the point of having an
 * icon column at all; hashing the name to a hue keeps entries distinguishable
 * while staying stable across renders, sessions and machines.
 */

// Evenly spread around the wheel, skipping the muddy 40-70deg yellow-olive
// band where white text loses contrast.
const HUES = [4, 20, 84, 150, 168, 190, 210, 230, 258, 280, 306, 330]

/** FNV-1a. Small, dependency-free, and well spread for short ASCII strings. */
function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // >>> 0 keeps it an unsigned 32-bit int; Math.imul can return negatives.
  return h >>> 0
}

export type MonogramColor = {
  /** Background, saturated enough to carry white text. */
  background: string
  /** Always white: every hue above is dark enough at 44% lightness. */
  foreground: string
}

/**
 * Map an arbitrary name to a stable background/foreground pair.
 * Empty or whitespace-only input falls back to a neutral grey.
 */
export function getMonogramColor(name: string): MonogramColor {
  const key = name.trim().toLowerCase()
  if (!key) {
    return { background: 'hsl(220 9% 60%)', foreground: '#fff' }
  }

  const hue = HUES[hashString(key) % HUES.length]
  return { background: `hsl(${hue} 58% 44%)`, foreground: '#fff' }
}

/** First character, uppercased. Empty input yields "?" rather than "". */
export function getMonogramLetter(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.charAt(0).toUpperCase()
}
