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

import { DEFAULT_WINDOW_DAYS, PROFIT_FILTER } from './constants'

/**
 * URL contract for the transaction ledger.
 *
 * Every field carries a `.catch()`: validateSearch runs before the route's
 * component exists, so a ZodError escapes to the root boundary and replaces the
 * whole app with an error page. A hand-edited `?days=abc` or a stale bookmark
 * must degrade to the default, not look like a server fault.
 */
export const transactionLedgerSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(undefined),
  days: z.number().optional().catch(DEFAULT_WINDOW_DAYS),
  /**
   * Explicit window in unix seconds, set together by the calendar. When both are
   * present they win over `days`, so a hand-picked range survives a reload and
   * can be shared as a link — the same contract the cost analytics page uses.
   */
  start: z.number().optional().catch(undefined),
  end: z.number().optional().catch(undefined),
  profit: z.string().optional().catch(PROFIT_FILTER.ALL),
  // Sort is URL state because the database applies it: a shared link to "today's
  // biggest losses" has to reproduce that ordering, not just that filter.
  sortBy: z.string().optional().catch(undefined),
  order: z.string().optional().catch(undefined),
  username: z.string().optional().catch(''),
  model: z.string().optional().catch(''),
  channel: z.string().optional().catch(''),
  group: z.string().optional().catch(''),
})

export type TransactionLedgerSearch = z.infer<
  typeof transactionLedgerSearchSchema
>
