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
import { describe, expect, it } from 'vitest'

import type { UsageLog } from '@/features/usage-logs/data/schema'

import { toLedgerRow } from '../ledger-row'

function makeLog(overrides: Partial<UsageLog> = {}): UsageLog {
  return {
    id: 1,
    user_id: 7,
    created_at: 1_750_000_000,
    type: 2,
    content: '',
    username: 'alice',
    token_name: 'prod-key',
    model_name: 'gpt-5.5',
    quota: 1000,
    prompt_tokens: 120,
    completion_tokens: 80,
    use_time: 3,
    is_stream: false,
    channel: 12,
    channel_name: 'azure-eastus',
    channel_type: 3,
    token_id: 5,
    group: 'default',
    ip: '',
    other: '',
    request_id: 'req-abc',
    upstream_request_id: '',
    cost_quota: 0,
    cost_source: '',
    margin_quota: 0,
    line_code: '',
    traffic_source: '',
    ...overrides,
  }
}

describe('toLedgerRow', () => {
  it('reads cost and profit from the row columns', () => {
    const row = toLedgerRow(
      makeLog({
        quota: 1000,
        cost_quota: 400,
        cost_source: 'exact',
        margin_quota: 600,
        line_code: 'gpt-fast',
      })
    )

    expect(row.costQuota).toBe(400)
    expect(row.profitQuota).toBe(600)
    expect(row.marginRate).toBeCloseTo(0.6)
    expect(row.grade).toBe('priced')
    expect(row.lineCode).toBe('gpt-fast')
  })

  // The backend stores cost_quota 0 with an 'unknown' grade when a request could
  // not be priced. Reading that 0 as a cost would report 100% margin on a
  // request whose cost is simply not known, which is the single most misleading
  // number this page could show.
  it.each(['unknown', ''])('treats %o cost source as unpriced', (source) => {
    const row = toLedgerRow(
      makeLog({ quota: 1000, cost_quota: 0, cost_source: source })
    )

    expect(row.costQuota).toBeNull()
    expect(row.profitQuota).toBeNull()
    expect(row.marginRate).toBeNull()
    expect(row.grade).toBe('unpriced')
  })

  // A task's differential settlement carries the task TOTAL cost while its row
  // holds only the delta, so the write path stores those rows unpriced on
  // purpose. The row must not resurrect the figure from the JSON snapshot — that
  // would count one task's upstream cost twice.
  it('does not recover cost from the snapshot when the columns are unpriced', () => {
    const row = toLedgerRow(
      makeLog({
        quota: 200,
        cost_source: '',
        other: JSON.stringify({
          admin_info: {
            cost: { cost_source: 'exact', cost_quota: 5000, row_scoped: false },
          },
        }),
      })
    )

    expect(row.costQuota).toBeNull()
    expect(row.profitQuota).toBeNull()
  })

  it('keeps a negative profit visible', () => {
    const row = toLedgerRow(
      makeLog({
        quota: 300,
        cost_quota: 500,
        cost_source: 'exact',
        margin_quota: -200,
      })
    )

    expect(row.profitQuota).toBe(-200)
    expect(row.marginRate).toBeCloseTo(-200 / 300)
  })

  // A zero-revenue request is real (free model) but its margin rate is undefined
  // rather than 0%, so the grade separates it from an unpriced row.
  it('grades a zero-revenue priced request as free', () => {
    const row = toLedgerRow(
      makeLog({
        quota: 0,
        cost_quota: 50,
        cost_source: 'exact',
        margin_quota: -50,
      })
    )

    expect(row.grade).toBe('free')
    expect(row.marginRate).toBeNull()
    expect(row.profitQuota).toBe(-50)
  })

  it('falls back to the snapshot line code for rows predating the column', () => {
    const row = toLedgerRow(
      makeLog({
        line_code: '',
        other: JSON.stringify({
          admin_info: { price: { line_code: 'legacy-route' } },
        }),
      })
    )

    expect(row.lineCode).toBe('legacy-route')
  })

  // An upstream name echoing the client name is noise in a table this wide, so
  // it is only surfaced when a mapping actually changed it.
  it('surfaces the upstream model name only when it differs', () => {
    const same = toLedgerRow(
      makeLog({
        model_name: 'gpt-5.5',
        other: JSON.stringify({ upstream_model_name: 'gpt-5.5' }),
      })
    )
    const mapped = toLedgerRow(
      makeLog({
        model_name: 'gpt-5.5',
        other: JSON.stringify({ upstream_model_name: 'gpt-5.5-0711' }),
      })
    )

    expect(same.upstreamModelName).toBe('')
    expect(mapped.upstreamModelName).toBe('gpt-5.5-0711')
  })
})
