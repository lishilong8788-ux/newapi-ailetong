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
 * Resolves the Lucide icon names carried by the capability registry and the
 * model guides into components.
 *
 * Explicit registration, not dynamic lookup: `lucide-react` exports well over a
 * thousand icons, and reaching into the namespace by string would defeat tree
 * shaking and pull all of them into the bundle. Every name here is also checked
 * by a test, so a typo fails the suite instead of rendering nothing.
 *
 * Vendor logos are a separate concern handled by `getLobeIcon`.
 */
import {
  BarChart,
  Brush,
  Clock,
  CodeSquare,
  Combine,
  Gauge,
  GraduationCap,
  Images,
  Layers,
  Monitor,
  NotepadText,
  RectangleHorizontal,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Type,
  type LucideIcon,
} from 'lucide-react'

export const CAPABILITY_ICONS: Record<string, LucideIcon> = {
  BarChart,
  Brush,
  Clock,
  CodeSquare,
  Combine,
  Gauge,
  GraduationCap,
  Images,
  Layers,
  Monitor,
  NotepadText,
  RectangleHorizontal,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Type,
}

/**
 * Returns the icon for a registry name, or `undefined` when it is not
 * registered. Callers render nothing in that case — a missing glyph is a far
 * better failure than a crashed panel.
 */
export function getCapabilityIcon(name: string): LucideIcon | undefined {
  return CAPABILITY_ICONS[name]
}
