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
import type { AgentAnalyticsRow } from '../../types'

/** 2026-03-18T00:00:00Z — the fixed "now" the dormancy tests reason from. */
export const NOW = 1_773_792_000

/**
 * A zeroed agent row. Tests set only the fields the assertion depends on, so a
 * later contract change surfaces as a type error instead of a silent default.
 */
export function agentRow(
  overrides: Partial<AgentAnalyticsRow> = {}
): AgentAnalyticsRow {
  return {
    agent_user_id: 1,
    username: 'agent',
    display_name: 'Agent',
    customer_count: 0,
    paying_customer_count: 0,
    paying_rate: 0,
    revenue: 0,
    avg_revenue_per_customer: 0,
    commission: 0,
    effective_rate: 0,
    first_commission_time: 0,
    last_commission_time: 0,
    active_30d: 0,
    ...overrides,
  }
}
