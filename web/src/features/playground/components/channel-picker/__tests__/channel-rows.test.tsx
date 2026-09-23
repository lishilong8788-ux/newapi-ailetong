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
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'

import { buildRoute, renderPicker } from './fixtures'

// What one row is allowed to claim. Every case here is a way the sidebar could
// hand a reader a number that is not about the line they are looking at.

beforeEach(() => {
  window.localStorage.clear()
})

describe('ChannelRouteRow identity', () => {
  test('falls back to #id when the operator set no line code', () => {
    // The public endpoint strips `name`, so most rows a non-admin sees have
    // neither a code nor a name. `#19` is the normal rendering, not a defect.
    renderPicker({ routes: [buildRoute({ channel_id: 19 })] })

    expect(screen.getByText('#19')).toBeInTheDocument()
  })

  test('prefers the line code over the id when one exists', () => {
    renderPicker({ routes: [buildRoute({ channel_id: 19, code: 'hs4' })] })

    expect(screen.getByText('hs4')).toBeInTheDocument()
    expect(screen.queryByText('#19')).not.toBeInTheDocument()
  })
})

describe('ChannelRouteRow availability', () => {
  test('marks a borrowed group figure', () => {
    // The channel served no traffic, so the number is the model+group aggregate
    // every line in that group shares. Printing it bare hands this line another
    // channel's results.
    renderPicker({
      routes: [
        buildRoute({ availability_pct: 99.1, availability_source: 'group' }),
      ],
    })

    expect(screen.getByText('99.1%')).toBeInTheDocument()
    expect(
      screen.getByLabelText(
        'Group average; this channel has no traffic of its own yet'
      )
    ).toBeInTheDocument()
  })

  test('leaves a channel’s own figure unmarked', () => {
    renderPicker({
      routes: [
        buildRoute({ availability_pct: 99.1, availability_source: 'channel' }),
      ],
    })

    expect(screen.getByText('99.1%')).toBeInTheDocument()
    expect(
      screen.queryByLabelText(
        'Group average; this channel has no traffic of its own yet'
      )
    ).not.toBeInTheDocument()
  })

  test('marks a borrowed first-token time independently of availability', () => {
    // A channel serving only non-streaming traffic has a measured availability
    // and a borrowed first token at the same time, so one mark per figure.
    renderPicker({
      routes: [
        buildRoute({
          availability_pct: 99.1,
          availability_source: 'channel',
          ttft_ms: 1615,
          ttft_source: 'group',
        }),
      ],
    })

    expect(
      screen.getAllByLabelText(
        'Group average; this channel has no traffic of its own yet'
      )
    ).toHaveLength(1)
    expect(screen.getByText('1.61s')).toBeInTheDocument()
  })

  test('says an unmeasured channel is unmeasured instead of scoring it', () => {
    // No traffic means no availability. 100% would turn absence of evidence into
    // a recommendation and 0% would accuse a working line of being broken.
    renderPicker({ routes: [buildRoute({ availability_pct: undefined })] })

    expect(screen.getByText('Not measured yet')).toBeInTheDocument()
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  test('renders a fully failing channel differently from an unmeasured one', () => {
    renderPicker({ routes: [buildRoute({ availability_pct: 0 })] })

    expect(screen.getByText('0.0%')).toBeInTheDocument()
    expect(screen.queryByText('Not measured yet')).not.toBeInTheDocument()
  })
})

describe('ChannelRouteRow first token', () => {
  test('prints a dash when no streaming request has been measured', () => {
    renderPicker({ routes: [buildRoute({ ttft_ms: undefined })] })

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  test('prints a dash for a zero first-token time', () => {
    // 0 reaches the client from a channel that has only served non-streaming
    // requests; it is an absence, not a suspiciously fast reply.
    renderPicker({ routes: [buildRoute({ ttft_ms: 0 })] })

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  test('does not substitute the channel test round trip for a first token', () => {
    // `latency_ms` is one hand-fired probe. In a two-line row with no space to
    // label it, showing it here would read as a measured first token.
    renderPicker({ routes: [buildRoute({ latency_ms: 3930 })] })

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('3.93s')).not.toBeInTheDocument()
  })
})

describe('ChannelRouteRow states no price', () => {
  /**
   * A row names a line and reports how it behaves; it quotes nothing.
   *
   * Asserted against a channel that has its own tier and a real discount — the
   * case that previously rendered both a rate and a badge — because that is the
   * one where a reintroduced quote would look correct rather than obviously
   * wrong. The composer and the pricing page are where a price belongs; a
   * per-channel figure here read at group ratio 1 beside a composer quote that
   * includes the group multiplier put two different numbers for one model a step
   * apart.
   */
  test('quotes neither a rate nor a discount on a channel-priced row', () => {
    renderPicker({
      routes: [
        buildRoute({
          price: { price_source: 'channel', model_ratio: 0.42, discount: 0.42 },
        }),
      ],
    })

    expect(screen.queryByText(/% off/)).not.toBeInTheDocument()
    expect(screen.queryByText(/折/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/¥/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\/M/)).not.toBeInTheDocument()
    expect(screen.queryByTitle('Channel price · Input')).not.toBeInTheDocument()

    // The identity and the measurements are still the point of the row.
    expect(screen.getByText('#7')).toBeInTheDocument()
  })
})
