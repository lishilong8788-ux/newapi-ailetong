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
import { useRouterState } from '@tanstack/react-router'

import { usePublicChromeStore } from '../lib/public-chrome'
import { PublicHeader } from './public-header'

function MountedPublicHeader() {
  const tone = usePublicChromeStore((state) => state.tone)

  return <PublicHeader tone={tone} />
}

/**
 * Mounts the public header once, as a sibling of the router outlet.
 *
 * Previously each public page rendered its own `PublicLayout`, so switching
 * pages tore the header down and built a new one: the nav indicator's shared
 * layout animation had nothing to animate from, and the logo/notifications/
 * profile subtree was rebuilt on every navigation. Routes opt in with
 * `staticData.publicChrome`, which is known before the page component renders,
 * so there is no first-paint flash.
 */
export function PublicChrome() {
  const active = useRouterState({
    select: (s) =>
      s.matches.some(
        (match) =>
          (match.staticData as { publicChrome?: boolean } | undefined)
            ?.publicChrome === true
      ),
  })

  if (!active) return null

  return <MountedPublicHeader />
}
