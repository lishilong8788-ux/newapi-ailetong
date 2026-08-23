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
import { useLayoutEffect } from 'react'
import { create } from 'zustand'

import type { PublicHeaderTone } from '../components/public-header'

type PublicChromeState = {
  tone: PublicHeaderTone
  setTone: (tone: PublicHeaderTone) => void
}

/**
 * Tone of the floating public header.
 *
 * The header itself is mounted once, above the router outlet, so it survives
 * navigation between public pages — that is what lets the active-item indicator
 * slide instead of jumping, and keeps the popovers/skeletons from rebuilding on
 * every switch. Pages can no longer pass the tone as a prop, so they publish it
 * here instead; admin-authored HTML decides it at runtime (see
 * `requestsInvertedNav`), which rules out a purely static route declaration.
 */
export const usePublicChromeStore = create<PublicChromeState>()((set) => ({
  tone: 'auto',
  setTone: (tone) => set((state) => (state.tone === tone ? state : { tone })),
}))

/**
 * Declare the header tone for the page currently rendering. Runs in a layout
 * effect so the header re-renders in the same commit, before paint.
 */
export function usePublicHeaderTone(tone: PublicHeaderTone = 'auto'): void {
  useLayoutEffect(() => {
    usePublicChromeStore.getState().setTone(tone)
    return () => usePublicChromeStore.getState().setTone('auto')
  }, [tone])
}
