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
import { useId, type ReactNode } from 'react'

interface ChartFrameProps {
  /** Accessible name for the chart. */
  label: string
  /**
   * What the chart shows and where the same numbers are readable as text. A
   * canvas chart exposes nothing to a screen reader, so the description has to
   * point at the detail table rather than pretend the visual is sufficient.
   */
  description: string
  children: ReactNode
}

/**
 * Gives a VChart canvas an accessible name and description.
 *
 * VChart renders to canvas, so the plotted values are unreachable by assistive
 * technology no matter how the surrounding markup is arranged. This is why every
 * figure on the page is also present in the channels detail table — the chart is
 * the summary, the table is the accessible presentation.
 */
export function ChartFrame(props: ChartFrameProps) {
  const descriptionId = `chart-desc-${useId().replaceAll(':', '')}`

  return (
    <div className='h-[280px] w-full sm:h-[320px]'>
      <div
        role='img'
        aria-label={props.label}
        aria-describedby={descriptionId}
        className='h-full w-full'
      >
        {props.children}
      </div>
      <p id={descriptionId} className='sr-only'>
        {props.description}
      </p>
    </div>
  )
}
