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
import { useCallback } from 'react'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundInput } from './components/input/playground-input'
import { ModelLibrary } from './components/model-library/model-library'
import {
  useChatHandler,
  useImageHandler,
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

  /**
   * Resolved here rather than deeper down because this is the only layer holding
   * both the model list and the active config. Undefined while the list loads,
   * or when the stored model is no longer in the user's permission set.
   */
  const selectedModelOption = models.find(
    (option) => option.value === config.model
  )
  const isImageModel = selectedModelOption?.modality === 'image'

  /**
   * Which pipeline a submission takes, decided by the selected model's modality.
   *
   * The conversation hook appends the user/assistant message pair and then hands
   * the transcript to whatever this returns, so the two pipelines share every
   * message-shaping concern (edit, regenerate, delete) and differ only in the
   * request. Image generation takes the prompt alone — there is no multi-turn
   * context to send.
   */
  const sendForModality = useCallback(
    (nextMessages: Message[]) => {
      if (!isImageModel) {
        sendChat(nextMessages)
        return
      }

      const prompt = getLastUserMessageText(nextMessages)
      if (prompt) {
        void sendImage(prompt)
      }
    },
    [isImageModel, sendChat, sendImage]
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
      updateConfig('model', value)
    },
    [handleEditOpenChange, updateConfig]
  )

  /** Group is a billing/routing choice, not a different model, so history stays. */
  const handleGroupChange = useCallback(
    (value: string) => updateConfig('group', value),
    [updateConfig]
  )

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  /** Either pipeline occupies the composer, so the button state is their union. */
  const isBusy = isGenerating || isGeneratingImage

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
        />
      </aside>

      <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
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
            onStop={isImageModel ? stopImage : stopGeneration}
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
