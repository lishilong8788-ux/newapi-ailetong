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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Loader } from '@/components/ai-elements/loader'
import { Message } from '@/components/ai-elements/message'

import {
  getChatMessageRenderState,
  getEditingMessageContent,
  getMessageAlignment,
  getPreviousUserMessage,
  isErrorMessage,
} from '../../lib'
import type {
  Message as MessageType,
  ModelOption,
  PlaygroundMessageLayoutMode,
} from '../../types'
import { MessageActions } from '../message/message-actions'
import { MessageErrorActions } from '../message/message-error-actions'
import { PlaygroundMessageContent } from '../message/playground-message-content'
import { PlaygroundMessageEditor } from '../message/playground-message-editor'
import { PlaygroundEmptyState } from './playground-empty-state'

const MAX_RENDERED_HISTORY_MESSAGES = 24

interface PlaygroundChatProps {
  messages: MessageType[]
  onCopyMessage?: (message: MessageType) => void
  onRegenerateMessage?: (message: MessageType) => void
  onEditMessage?: (message: MessageType) => void
  onDeleteMessage?: (message: MessageType) => void
  onSelectPrompt?: (prompt: string) => void
  isGenerating?: boolean
  isLoadingMessages?: boolean
  editingKey?: string | null
  onSaveEdit?: (newContent: string) => void
  onCancelEdit?: (open: boolean) => void
  onSaveEditAndSubmit?: (newContent: string) => void
  messageLayoutMode?: PlaygroundMessageLayoutMode
  /** Forwarded to the empty state, which renders this model's guide. */
  selectedModel?: ModelOption
}

export function PlaygroundChat({
  messages,
  onCopyMessage,
  onRegenerateMessage,
  onEditMessage,
  onDeleteMessage,
  onSelectPrompt,
  isGenerating = false,
  isLoadingMessages = false,
  editingKey,
  onSaveEdit,
  onCancelEdit,
  onSaveEditAndSubmit,
  messageLayoutMode = 'alternating',
  selectedModel,
}: PlaygroundChatProps) {
  const { t } = useTranslation()
  const [editText, setEditText] = useState('')
  const [originalText, setOriginalText] = useState('')
  const [sourceMessageKeys, setSourceMessageKeys] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const visibleMessageOffset = Math.max(
    0,
    messages.length - MAX_RENDERED_HISTORY_MESSAGES
  )
  const visibleMessages = messages.slice(visibleMessageOffset)

  function handleToggleMessageSource(message: MessageType): void {
    setSourceMessageKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys)

      if (nextKeys.has(message.key)) {
        nextKeys.delete(message.key)
      } else {
        nextKeys.add(message.key)
      }

      return nextKeys
    })
  }

  useEffect(() => {
    if (!editingKey) return
    const content = getEditingMessageContent(messages, editingKey)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditText(content)

    setOriginalText(content)
  }, [editingKey, messages])

  const centeredContainerClass = 'mx-auto w-full max-w-4xl px-4 py-4'
  /**
   * The states that opt out of `Conversation` still have to survive a short
   * viewport, so they keep their own scroll rather than inheriting the sticky
   * container's. `hover-scrollbar` matches the model library and pricing
   * sidebar; `ScrollArea` is reserved for dialogs in this repo.
   */
  const staticStateClass = `hover-scrollbar min-h-0 flex-1 overflow-y-auto ${centeredContainerClass}`

  /**
   * The empty and loading states deliberately skip `Conversation`.
   *
   * `Conversation` is `StickToBottom` with `resize='smooth'`, which watches its
   * content with a `ResizeObserver` and runs a spring animation whenever the
   * height changes. There is nothing to scroll in either state, and the guide
   * panel remounts at a different height on every model switch — which put a
   * scroll animation on a path that has no scrolling in it, and let those
   * animations pile up when models were switched faster than each spring
   * settled. Messages still get the sticky container below.
   */
  if (isLoadingMessages) {
    return (
      <div className={staticStateClass}>
        <div className='text-muted-foreground flex min-h-[min(520px,calc(100svh-18rem))] items-center justify-center gap-2 text-sm'>
          <Loader />
          <span>{t('Loading conversation...')}</span>
        </div>
      </div>
    )
  }

  if (visibleMessages.length === 0 && onSelectPrompt) {
    return (
      <div className={staticStateClass}>
        {/* Keyed by model, not a constant: switching models should read as
            arriving at a new surface, so the guide is remounted (replaying its
            entrance) rather than diffed field by field into the previous
            model's panel. */}
        <PlaygroundEmptyState
          key={`empty:${selectedModel?.value ?? 'none'}`}
          model={selectedModel}
          onSelectPrompt={onSelectPrompt}
        />
      </div>
    )
  }

  const chatContent = visibleMessages.map((message, visibleMessageIndex) => {
    const messageIndex = visibleMessageOffset + visibleMessageIndex
    const { alwaysShowActions, content, isEditing } = getChatMessageRenderState(
      messages,
      message,
      messageIndex,
      editingKey
    )
    const isError = isErrorMessage(message)
    const previousUserMessage = isError
      ? getPreviousUserMessage(messages, messageIndex)
      : null
    const alignment = getMessageAlignment(message, messageLayoutMode)
    const isSourceVisible = sourceMessageKeys.has(message.key)

    return (
      <Message
        className='group flex-row-reverse py-2.5'
        from={message.from}
        key={message.key}
      >
        <div className='w-full min-w-0 flex-1 basis-full'>
          {isEditing ? (
            <PlaygroundMessageEditor
              editText={editText}
              message={message}
              onCancelEdit={onCancelEdit}
              onEditTextChange={setEditText}
              onSaveEdit={onSaveEdit}
              onSaveEditAndSubmit={onSaveEditAndSubmit}
              originalText={originalText}
            />
          ) : (
            <PlaygroundMessageContent
              alignment={alignment}
              actions={
                <MessageActions
                  message={message}
                  onCopy={onCopyMessage}
                  onRegenerate={onRegenerateMessage}
                  onToggleSource={handleToggleMessageSource}
                  onEdit={onEditMessage}
                  onDelete={onDeleteMessage}
                  isSourceVisible={isSourceVisible}
                  isGenerating={isGenerating}
                  alwaysVisible={alwaysShowActions}
                  className='mt-1.5'
                />
              }
              isSourceVisible={isSourceVisible}
              message={message}
              errorActions={
                isError ? (
                  <MessageErrorActions
                    disabled={isGenerating}
                    onRetry={
                      onRegenerateMessage
                        ? () => onRegenerateMessage(message)
                        : undefined
                    }
                    onEditPrompt={
                      onEditMessage && previousUserMessage
                        ? () => onEditMessage(previousUserMessage)
                        : undefined
                    }
                    onDelete={
                      onDeleteMessage
                        ? () => onDeleteMessage(message)
                        : undefined
                    }
                  />
                ) : undefined
              }
              versionContent={content}
            />
          )}
        </div>
      </Message>
    )
  })

  return (
    <Conversation>
      {/* Remove outer padding; apply padding to inner centered container to align with input */}
      <ConversationContent className='p-0'>
        <div className={centeredContainerClass}>{chatContent}</div>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
