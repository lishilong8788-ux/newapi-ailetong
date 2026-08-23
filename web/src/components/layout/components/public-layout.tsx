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
import { usePublicHeaderTone } from '../lib/public-chrome'
import type { PublicHeaderTone } from './public-header'

type PublicLayoutProps = {
  children: React.ReactNode
  showMainContainer?: boolean
  headerTone?: PublicHeaderTone
}

/**
 * Page shell for public routes. The floating header is *not* rendered here — it
 * is mounted once by `PublicChrome` above the outlet so it survives navigation.
 * This component only owns the page background and content container, and tells
 * the shared header which tone the current page needs.
 */
export function PublicLayout(props: PublicLayoutProps) {
  usePublicHeaderTone(props.headerTone ?? 'auto')

  // `bg-canvas`, not `bg-background`: this is a page shell, so it sits one step
  // below the card surfaces it hosts. `--background` stays reserved for
  // surfaces *inside* cards (detail tiles, code blocks, table rows).
  return (
    <div className='bg-canvas text-foreground relative min-h-svh overflow-x-clip'>
      {props.showMainContainer !== false ? (
        <main className='container px-4 py-6 pt-20 md:px-4'>
          {props.children}
        </main>
      ) : (
        props.children
      )}
    </div>
  )
}
