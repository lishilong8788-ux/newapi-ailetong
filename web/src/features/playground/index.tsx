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
import { useCallback, useEffect, useState } from 'react'

import { useChannelPricing } from '@/features/pricing/hooks/use-channel-pricing'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundTopbar } from './components/chat/playground-topbar'
import { PlaygroundInput } from './components/input/playground-input'
import { ModelLibrary } from './components/model-library/model-library'
import {
  useChatHandler,
  useImageHandler,
  useVideoHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'
import { getLastUserMessageText } from './lib'
import type { Message } from './types'

export function Playground() {
  const {
    config,
    messages,
    isLoadingMessages,
    models,
    groups,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    updateConfigFields,
    clearMessages,
    paramChipValues,
    updateParamChip,
  } = usePlaygroundState()

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    onMessageUpdate: updateMessages,
  })

  const { sendImage, stopImage, isGeneratingImage } = useImageHandler({
    config,
    paramChipValues,
    onMessageUpdate: updateMessages,
  })

  const { sendVideo, stopVideo, isGeneratingVideo } = useVideoHandler({
    config,
    paramChipValues,
    onMessageUpdate: updateMessages,
  })

  /**
   * Resolved here rather than deeper down because this is the only layer holding
   * both the model list and the active config. Undefined while the list loads,
   * or when the stored model is no longer in the user's permission set.
   */
  const selectedModelOption = models.find(
    (option) => option.value === config.model
  )
  const modality = selectedModelOption?.modality
  const isImageModel = modality === 'image'
  const isVideoModel = modality === 'video'

  /**
   * Which pipeline a submission takes, decided by the selected model's modality.
   *
   * The conversation hook appends the user/assistant message pair and then hands
   * the transcript to whatever this returns, so all three pipelines share every
   * message-shaping concern (edit, regenerate, delete) and differ only in the
   * request. Image and video take the prompt alone — there is no multi-turn
   * context to send.
   */
  const sendForModality = useCallback(
    (nextMessages: Message[]) => {
      if (!isImageModel && !isVideoModel) {
        sendChat(nextMessages)
        return
      }

      const prompt = getLastUserMessageText(nextMessages)
      if (!prompt) return

      if (isVideoModel) {
        void sendVideo(prompt)
        return
      }

      void sendImage(prompt)
    },
    [isImageModel, isVideoModel, sendChat, sendImage, sendVideo]
  )

  const {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  } = usePlaygroundConversation({
    messages,
    updateMessages,
    sendChat: sendForModality,
  })

  const handleClearMessages = () => {
    handleEditOpenChange(false)
    clearMessages()
  }

  /**
   * Switching models swaps the transcript and leaves anything in flight running.
   *
   * This used to call `stopGeneration`/`stopImage` first, because writes went to
   * whichever model was selected when a chunk arrived — so a stream that outlived
   * the switch appended to the incoming model's history. Both handlers now pin the
   * model at send time and route every write there, so the request finishes into
   * the transcript that asked for it and is waiting when you switch back.
   *
   * Aborting was the visible cost of that: a reply a minute into an image
   * generation died because the user looked at another model. One request at a
   * time is still the rule — sending again supersedes what came before — but
   * merely looking elsewhere no longer counts as cancelling.
   *
   * The open message editor still closes: it belongs to the outgoing transcript,
   * and its buffered text has no meaning against a different conversation.
   *
   * Stable identity, because the library's cards are memoised and a fresh arrow
   * function on every render would defeat that entirely — with a few hundred
   * models in the list, that is the difference between re-rendering two cards per
   * selection and re-rendering all of them.
   */
  const handleSelectModel = useCallback(
    (value: string) => {
      handleEditOpenChange(false)
      // One write, not two. A pinned channel serves specific models, so carrying
      // it across a model switch names a line that cannot answer the new model —
      // the relay rejects that with a 400. Done as two `updateConfig` calls the
      // first one persists the new model beside the stale channel, a pairing that
      // is never valid and that a reload landing in between would restore.
      updateConfigFields({ model: value, channelId: undefined })
    },
    [handleEditOpenChange, updateConfigFields]
  )

  /**
   * Group is a billing/routing choice, not a different model, so history stays.
   *
   * The pinned channel does not: `/api/pricing/channels` filters routes to the
   * groups the caller can reach, so a channel reachable in one group may not be
   * in another, and the pin would survive as an id absent from the list beside it.
   */
  const handleGroupChange = useCallback(
    (value: string) =>
      updateConfigFields({ group: value, channelId: undefined }),
    [updateConfigFields]
  )

  /** Stable identity, because the library's channel rows are memoised too. */
  const handleChannelChange = useCallback(
    (channelId: number | undefined) => updateConfig('channelId', channelId),
    [updateConfig]
  )

  /**
   * Debug mode, owned here because two surfaces share it: the topbar switch and
   * every assistant message's panel entry. In-memory only — it is a posture for
   * the current sitting, not a preference worth restoring three weeks later.
   */
  const [isDebugEnabled, setIsDebugEnabled] = useState(false)

  /**
   * The pinned channel's own details, for the topbar.
   *
   * The config stores only an id, because that is all a request needs; the line
   * code and category live on the route list. Same query key and 60s staleTime as
   * the sidebar's channel block, so this shares that cache rather than adding a
   * request.
   */
  const { routes: channelRoutes, isLoading: isLoadingChannels } =
    useChannelPricing(config.model || undefined)

  const pinnedRoute = config.channelId
    ? channelRoutes.find((route) => route.channel_id === config.channelId)
    : undefined

  /**
   * Drop a pin that the current model and group can no longer reach.
   *
   * Channels get deleted, disabled, or moved out of a group between sittings, and
   * the id survives in localStorage. Left in place it reaches `Distribute()`,
   * which answers 403 for a disabled channel — on every send, with a message that
   * reads as the playground being broken rather than as one stale setting.
   *
   * Guarded on a settled, non-empty list: while the query is loading or has
   * failed, `routes` is `[]` for reasons that say nothing about the pin, and
   * clearing on that would discard a perfectly good choice.
   */
  useEffect(() => {
    if (!config.channelId || isLoadingChannels) return
    if (channelRoutes.length === 0) return
    if (channelRoutes.some((route) => route.channel_id === config.channelId)) {
      return
    }

    updateConfig('channelId', undefined)
  }, [config.channelId, channelRoutes, isLoadingChannels, updateConfig])

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  /** Any pipeline occupies the composer, so the button state is their union. */
  const isBusy = isGenerating || isGeneratingImage || isGeneratingVideo

  /**
   * Stopping means different things per pipeline, so it is dispatched rather than
   * unioned: for video it only stops *watching* — the task runs on regardless.
   */
  const stopForModality = isVideoModel
    ? stopVideo
    : isImageModel
      ? stopImage
      : stopGeneration

  return (
    <div className='relative flex size-full min-h-0 overflow-hidden'>
      {/* Model library: the primary entry point, since people arrive knowing
          the capability they want rather than the conversation they want.
          Hidden below `lg` where there is no room for two columns; the composer
          exposes the same library as a drawer (`ModelLibrarySheet`) there. */}
      <aside className='border-border/60 hidden w-72 shrink-0 border-r lg:flex'>
        <ModelLibrary
          models={models}
          selectedModel={config.model}
          isLoading={isLoadingModels}
          onSelectModel={handleSelectModel}
          groups={groups}
          groupValue={config.group}
          onGroupChange={handleGroupChange}
          channelId={config.channelId}
          onChannelChange={handleChannelChange}
        />
      </aside>

      <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
        {/* Outside the scroll container below, so it stays put while the
            transcript scrolls under it. Rendered at every breakpoint: the library
            sidebar is `hidden lg:flex`, so below `lg` this is the only thing on
            screen naming the channel the next request will use. */}
        <PlaygroundTopbar
          modelName={config.model}
          channel={
            pinnedRoute
              ? { id: pinnedRoute.channel_id, code: pinnedRoute.code }
              : undefined
          }
          isStreamEnabled={config.stream}
          onStreamEnabledChange={(streamEnabled) =>
            updateConfig('stream', streamEnabled)
          }
          isDebugEnabled={isDebugEnabled}
          onDebugEnabledChange={setIsDebugEnabled}
        />

        {/* Full-width scroll container: scrolling works even over side whitespace */}
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <PlaygroundChat
            messages={messages}
            isLoadingMessages={isLoadingMessages}
            onRegenerateMessage={handleRegenerateMessage}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onSelectPrompt={handleSendMessage}
            isGenerating={isBusy}
            editingKey={editingMessageKey}
            onCancelEdit={handleEditOpenChange}
            onSaveEdit={(newContent) => applyEdit(newContent, false)}
            onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
            selectedModel={selectedModelOption}
            isDebugEnabled={isDebugEnabled}
          />
        </div>

        {/* Input area: center content and constrain to the same container width */}
        <div className='mx-auto w-full max-w-4xl'>
          <PlaygroundInput
            disabled={isBusy}
            groups={groups}
            groupValue={config.group}
            isGenerating={isBusy}
            isModelLoading={isLoadingModels}
            modelValue={config.model}
            models={models}
            onGroupChange={handleGroupChange}
            onClearMessages={handleClearMessages}
            onModelChange={handleSelectModel}
            onStop={stopForModality}
            onSubmit={handleSendMessage}
            hasMessages={messages.length > 0}
            selectedModel={selectedModelOption}
            paramChipValues={paramChipValues}
            onParamChipChange={updateParamChip}
          />
        </div>
      </div>
    </div>
  )
}
