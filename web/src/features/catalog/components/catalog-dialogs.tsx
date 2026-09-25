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
/**
 * Every editor this page can open, mounted once.
 *
 * The model and channel editors are the same components the models and channels
 * pages use, not copies of them: a channel has ~40 fields across six tabs and a
 * model writes into the global ratio maps, and a second implementation of either
 * would drift within a release. That is the whole reason this page can replace
 * the round trip through three pages — it reuses their editors rather than
 * reimplementing a subset.
 *
 * Each editor is keyed on what it is editing so switching rows re-mounts it. The
 * drawers stay mounted across open/close cycles and reset on `open`, so without
 * the key a second edit can briefly show the first one's values.
 */
import type { Channel } from '@/features/channels/types'
import { ChannelsProvider } from '@/features/channels/components/channels-provider'
import { ChannelMutateDrawer } from '@/features/channels/components/drawers/channel-mutate-drawer'
import { ModelMutateDrawer } from '@/features/models/components/drawers/model-mutate-drawer'
import type { Model } from '@/features/models/types'

import { useCatalogEditor } from './catalog-provider'
import { AttachChannelsDialog } from './dialogs/attach-channels-dialog'
import { ChannelCostDialog } from './dialogs/channel-cost-dialog'

export type CatalogDialogsProps = {
  /** Every channel on the install, for the attach dialog's candidate list. */
  channels: readonly Channel[]
}

export function CatalogDialogs(props: CatalogDialogsProps) {
  const { editor, closeEditor } = useCatalogEditor()

  const modelDrawerOpen =
    editor.kind === 'create-model' || editor.kind === 'edit-model'
  const channelDrawerOpen =
    editor.kind === 'create-channel' || editor.kind === 'edit-channel'

  return (
    <>
      {/*
        `currentRow` doubles as the create-mode prefill: the drawer treats a row
        without an `id` as "create, pre-named", which is how the missing-models
        flow on the models page already seeds it. That is what lets an operator
        give a relay-only model a real metadata row from here.
      */}
      <ModelMutateDrawer
        key={
          editor.kind === 'edit-model'
            ? `model-${editor.model.id}`
            : `model-new-${editor.kind === 'create-model' ? (editor.modelName ?? '') : ''}`
        }
        open={modelDrawerOpen}
        onOpenChange={(open) => !open && closeEditor()}
        currentRow={resolveModelRow(editor)}
      />

      {/* The channel drawer reads `useChannels()` for its own close handling, so
          it needs the channels page's provider even though this page drives the
          open state itself. */}
      <ChannelsProvider>
        <ChannelMutateDrawer
          key={
            editor.kind === 'edit-channel'
              ? `channel-${editor.channel.id}`
              : 'channel-new'
          }
          open={channelDrawerOpen}
          onOpenChange={(open) => !open && closeEditor()}
          currentRow={editor.kind === 'edit-channel' ? editor.channel : null}
          prefillModels={
            editor.kind === 'create-channel' && editor.modelName
              ? [editor.modelName]
              : undefined
          }
        />
      </ChannelsProvider>

      {editor.kind === 'attach-channels' && (
        <AttachChannelsDialog
          open
          onOpenChange={(open) => !open && closeEditor()}
          modelName={editor.modelName}
          channels={props.channels}
        />
      )}

      {editor.kind === 'channel-cost' && (
        <ChannelCostDialog
          key={`cost-${editor.channel.id}-${editor.upstreamModel}`}
          open
          onOpenChange={(open) => !open && closeEditor()}
          channel={editor.channel}
          modelName={editor.modelName}
          upstreamModel={editor.upstreamModel}
        />
      )}
    </>
  )
}

/**
 * The row the model drawer should open with: the real one when editing, a
 * name-only stub when creating from an existing model name, and nothing at all
 * for a blank create.
 */
function resolveModelRow(
  editor: ReturnType<typeof useCatalogEditor>['editor']
): Model | null {
  if (editor.kind === 'edit-model') return editor.model
  if (editor.kind === 'create-model' && editor.modelName) {
    return { model_name: editor.modelName } as Model
  }
  return null
}
