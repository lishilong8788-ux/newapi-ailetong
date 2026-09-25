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
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { LedgerSummary } from '../../types'
import { LedgerTotalsBar } from '../ledger-totals-bar'

const WINDOW_LABEL = '2026-09-23 to 2026-09-23 · 1 days'

function buildSummary(overrides: Partial<LedgerSummary> = {}): LedgerSummary {
  return {
    request_count: 15,
    priced_count: 15,
    revenue_quota: 98_127,
    priced_revenue_quota: 98_127,
    cost_quota: 81_672,
    margin_quota: 16_455,
    unknown_revenue_quota: 0,
    margin_rate: 0.168,
    unpriced_rate: 0,
    ...overrides,
  }
}

describe('LedgerTotalsBar', () => {
  it('states the active window so a range total is not read as all-time', () => {
    render(
      <LedgerTotalsBar
        summary={buildSummary()}
        isLoading={false}
        windowLabel={WINDOW_LABEL}
      />
    )

    expect(screen.getByText(WINDOW_LABEL)).toBeInTheDocument()
  })

  it('renders the range totals with the margin rate as a percentage', () => {
    render(
      <LedgerTotalsBar
        summary={buildSummary()}
        isLoading={false}
        windowLabel={WINDOW_LABEL}
      />
    )

    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('16.8%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('reports how many rows carry no cost', () => {
    render(
      <LedgerTotalsBar
        summary={buildSummary({ priced_count: 11, unpriced_rate: 0.2667 })}
        isLoading={false}
        windowLabel={WINDOW_LABEL}
      />
    )

    expect(screen.getByText('4 without cost')).toBeInTheDocument()
    expect(screen.getByText('priced rows only')).toBeInTheDocument()
  })

  it('renders an empty range as zeros rather than as missing data', () => {
    render(
      <LedgerTotalsBar
        summary={buildSummary({
          request_count: 0,
          priced_count: 0,
          revenue_quota: 0,
          priced_revenue_quota: 0,
          cost_quota: 0,
          margin_quota: 0,
          margin_rate: null,
          unpriced_rate: null,
        })}
        isLoading={false}
        windowLabel={WINDOW_LABEL}
      />
    )

    expect(screen.getByText('0')).toBeInTheDocument()
    // Margin rate and coverage are undefined on an empty range, not 0%.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('keeps the panel shape while the first summary is still loading', () => {
    render(
      <LedgerTotalsBar
        summary={undefined}
        isLoading
        windowLabel={WINDOW_LABEL}
      />
    )

    // The labelled region and the window line survive the loading state, so the
    // panel does not collapse to a one-line placeholder and back.
    expect(
      screen.getByRole('region', { name: 'Ledger totals' })
    ).toBeInTheDocument()
    expect(screen.getByText(WINDOW_LABEL)).toBeInTheDocument()
    expect(screen.queryByText('16.8%')).not.toBeInTheDocument()
  })
})
