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
import type { SVGProps } from 'react'

type IconUnknownChannelProps = SVGProps<SVGSVGElement> & {
  size?: number
}

/**
 * Channel type 0 means "unrecognised", which previously rendered the OpenAI
 * mark and so read as a real OpenAI channel. A dashed circle with a question
 * mark says "unknown" instead of naming a vendor that was never selected.
 */
export function IconUnknownChannel({
  size = 20,
  ...props
}: IconUnknownChannelProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      width={size}
      height={size}
      fill='none'
      stroke='currentColor'
      strokeWidth='1.9'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      <circle cx='12' cy='12' r='9' strokeDasharray='3.2 2.6' />
      <path d='M9.4 9.3a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.1-2.6 3.9' />
      <path d='M12 17.6h.01' strokeWidth='2.4' />
    </svg>
  )
}
