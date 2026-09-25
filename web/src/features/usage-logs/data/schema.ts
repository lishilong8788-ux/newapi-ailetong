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
 * Zod schemas for common logs
 * This file should only contain Zod schemas and types inferred from them
 */
import { z } from 'zod'

// Usage log schema
export const usageLogSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  created_at: z.number(),
  type: z.number(),
  content: z.string(),
  username: z.string().default(''),
  token_name: z.string().default(''),
  model_name: z.string().default(''),
  quota: z.number().default(0),
  prompt_tokens: z.number().default(0),
  completion_tokens: z.number().default(0),
  use_time: z.number().default(0),
  is_stream: z.boolean().default(false),
  channel: z.number().default(0),
  channel_name: z.string().nullish().default(''),
  // Upstream vendor of the serving channel, resolved server-side from the
  // channel's type. Admin-only: blanked to 0 for non-admin log views alongside
  // channel_name. 0 also means "channel deleted since", so treat it as unknown
  // rather than as a real vendor id.
  channel_type: z.number().default(0),
  // Margin columns, denormalized server-side so the ledger can sort and filter
  // by profit in SQL. cost_source is what separates an unpriced row from a free
  // one: cost_quota 0 with an empty or 'unknown' source means the cost is not
  // known, and reading that 0 as a cost reports 100% margin. margin_quota is
  // always quota - cost_quota for priced rows, so the three columns sum
  // consistently. All admin-only — blanked for non-admin log views.
  cost_quota: z.number().default(0),
  cost_source: z.string().default(''),
  margin_quota: z.number().default(0),
  line_code: z.string().default(''),
  traffic_source: z.string().default(''),
  token_id: z.number().default(0),
  group: z.string().default(''),
  ip: z.string().default(''),
  other: z.string().default(''),
  request_id: z.string().default(''),
  upstream_request_id: z.string().default(''),
})

export type UsageLog = z.infer<typeof usageLogSchema>
