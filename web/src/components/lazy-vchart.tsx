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
// Type-only: a value import here would defeat the point and pull the charting
// bundle back into the importing chunk.
import type { VChart as VChartComponent } from '@visactor/react-vchart'
import {
  Component,
  Suspense,
  lazy,
  type ComponentProps,
  type ReactNode,
} from 'react'

const VChartImpl = lazy(async () => {
  const module = await import('@visactor/react-vchart')
  return { default: module.VChart }
})

type VChartProps = ComponentProps<typeof VChartComponent>

/**
 * VChart, kept off the route's critical path.
 *
 * The charting bundle is several megabytes. Imported statically it lands in the
 * chunk of whichever page renders it, so the rankings and model-detail pages
 * could not paint a single row until the whole charting engine had downloaded
 * and parsed. Deferring it lets the page render immediately and the chart fill
 * in behind a placeholder.
 */
export function LazyVChart(props: VChartProps) {
  return (
    <ChartBoundary>
      <Suspense
        fallback={
          <div aria-hidden className='bg-muted/30 h-full w-full rounded-lg' />
        }
      >
        <VChartImpl {...props} />
      </Suspense>
    </ChartBoundary>
  )
}

/**
 * Contains a chart failure to the chart.
 *
 * Two failures here are not the page's fault and must not cost the page: the
 * lazy import can reject (the charting bundle is several megabytes — one dropped
 * request on a sleeping laptop is enough, and `lazy` re-throws that during
 * render), and VChart's own mount/dispose can throw from inside a canvas
 * lifecycle we do not drive. Either one, unguarded, unwinds to the nearest error
 * boundary — which was the root, so a page of correctly-loaded numbers was
 * replaced by a full-screen error page.
 *
 * A class component because this is the error-boundary contract; there is no
 * hook equivalent.
 */
class ChartBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('[chart] render failed, falling back to placeholder', error)
  }

  render() {
    if (this.state.failed) {
      // Silent for assistive tech on purpose: every chart in this app is paired
      // with the same figures as text, so the reader has lost nothing.
      return (
        <div aria-hidden className='bg-muted/30 h-full w-full rounded-lg' />
      )
    }
    return this.props.children
  }
}
