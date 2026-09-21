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
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// Stands in for the several-megabyte charting bundle: the real one cannot mount
// on a jsdom canvas, and what is under test is the failure path around it.
const VChart = vi.fn(() => {
  throw new Error('canvas context unavailable')
})
vi.mock('@visactor/react-vchart', () => ({ VChart }))

const { LazyVChart } = await import('../lazy-vchart')

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

/**
 * A chart that throws must cost the chart and nothing else.
 *
 * Until this boundary existed the nearest one was the root route's, so a canvas
 * lifecycle failure on a page of already-loaded numbers unmounted the entire
 * admin shell in favour of the full-screen error page.
 */
describe('a chart that fails to mount', () => {
  test('degrades to a placeholder and leaves the page standing', async () => {
    render(
      <div>
        <p>margin trend</p>
        <LazyVChart spec={{ type: 'bar' }} />
      </div>
    )

    await waitFor(() => {
      // eslint-disable-next-line no-console
      expect(console.error).toHaveBeenCalledWith(
        '[chart] render failed, falling back to placeholder',
        expect.any(Error)
      )
    })
    expect(screen.getByText('margin trend')).toBeInTheDocument()
  })
})
