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
import { CHANNEL_TYPES } from '@/features/channels/constants'

/**
 * Display name of the upstream vendor behind a channel type.
 *
 * Returns '' for type 0, which the backend uses both for "channel deleted" and
 * for non-admin views — naming that "Unknown" would present an absence as a
 * vendor. Callers render the placeholder.
 *
 * Profit and text filtering are deliberately not here: both are SQL over the
 * denormalized margin columns now, so a client-side copy would narrow only the
 * rows already fetched while the totals described the whole range.
 */
export function vendorLabel(channelType: number): string {
  if (!channelType) return ''
  return CHANNEL_TYPES[channelType as keyof typeof CHANNEL_TYPES] ?? ''
}
