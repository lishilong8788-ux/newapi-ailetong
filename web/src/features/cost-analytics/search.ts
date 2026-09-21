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
import z from 'zod'

import { DEFAULT_WINDOW_DAYS } from './constants'

/**
 * URL contract for the cost analytics page.
 *
 * Every field needs a `.catch()`. `validateSearch` runs before the route's
 * component exists, so a ZodError here is not a page-level error the view can
 * report — it escapes to the root error boundary and replaces the whole app with
 * the error page. `?days=` or `?days=abc` (anything the search parser cannot
 * read as a number) was enough to do it, which made a hand-edited URL or a stale
 * bookmark look like a server fault.
 */
export const costAnalyticsSearchSchema = z.object({
  days: z.number().optional().catch(DEFAULT_WINDOW_DAYS),
  tab: z.string().optional().catch('overview'),
})

export type CostAnalyticsSearch = z.infer<typeof costAnalyticsSearchSchema>
