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

type IconGenericEndpointProps = SVGProps<SVGSVGElement> & {
  size?: number
}

/**
 * "Custom" channel types are not a vendor, so they get a protocol glyph
 * instead of a borrowed brand logo: a plug entering a socket.
 * Uses currentColor so it inherits text colour in both themes.
 */
export function IconGenericEndpoint({
  size = 20,
  ...props
}: IconGenericEndpointProps) {
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
      <path d='M9 3v5' />
      <path d='M15 3v5' />
      <path d='M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Z' />
      <path d='M12 17v4' />
    </svg>
  )
}
