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
import { Suspense, lazy, type ComponentProps } from 'react'

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
    <Suspense
      fallback={
        <div aria-hidden className='bg-muted/30 h-full w-full rounded-lg' />
      }
    >
      <VChartImpl {...props} />
    </Suspense>
  )
}
