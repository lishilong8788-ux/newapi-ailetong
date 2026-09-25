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
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import type { Channel } from '@/features/channels/types'
import type { Model } from '@/features/models/types'

/**
 * Which editor the page currently has open, and what it is editing.
 *
 * A discriminated union rather than the `open` + `currentRow` pair the channels
 * and models pages use: this page opens editors for two different entities from
 * five different places, and a shared `currentRow` would have to hold either a
 * `Channel` or a `Model` and be narrowed by the operator's last click.
 */
export type CatalogEditorState =
  | { kind: 'none' }
  /** Create a metadata row, optionally pre-named (an unpriced relay-only name). */
  | { kind: 'create-model'; modelName?: string }
  | { kind: 'edit-model'; model: Model }
  /** Create a channel, pre-seeded with the model the operator was looking at. */
  | { kind: 'create-channel'; modelName?: string }
  | { kind: 'edit-channel'; channel: Channel }
  /** Add one model to channels that do not list it yet. */
  | { kind: 'attach-channels'; modelName: string }
  /** Edit one channel's buy price for one model. */
  | {
      kind: 'channel-cost'
      channel: Channel
      modelName: string
      upstreamModel: string
    }

type CatalogContextValue = {
  editor: CatalogEditorState
  openEditor: (editor: CatalogEditorState) => void
  closeEditor: () => void
}

const CatalogContext = createContext<CatalogContextValue | undefined>(undefined)

export function CatalogProvider(props: { children: ReactNode }) {
  const [editor, setEditor] = useState<CatalogEditorState>({ kind: 'none' })

  const value = useMemo<CatalogContextValue>(
    () => ({
      editor,
      openEditor: setEditor,
      closeEditor: () => setEditor({ kind: 'none' }),
    }),
    [editor]
  )

  return (
    <CatalogContext.Provider value={value}>
      {props.children}
    </CatalogContext.Provider>
  )
}

export function useCatalogEditor() {
  const context = useContext(CatalogContext)
  if (!context) {
    throw new Error('useCatalogEditor must be used within CatalogProvider')
  }
  return context
}
