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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { parseChannelEcho, parseRequestId, sendChatCompletion } from '../api'
import { CHANNEL_HEADERS, ERROR_MESSAGES } from '../constants'
import {
  applyStreamingChunk,
  buildChatCompletionPayload,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
  parseRequestErrorDetails,
  applyChatCompletionResponse,
  completeAssistantMessage,
  hasChatCompletionChoice,
  isAssistantMessageFinal,
  isAssistantMessagePending,
  hasErrorExplanation,
} from '../lib'
import type { Message, PlaygroundConfig } from '../types'
import { useStreamRequest } from './use-stream-request'

interface UseChatHandlerOptions {
  config: PlaygroundConfig
  onMessageUpdate: (
    updater: (prev: Message[]) => Message[],
    targetModel?: string
  ) => void
}

const KNOWN_ERROR_MESSAGES = new Set<string>(Object.values(ERROR_MESSAGES))
const STREAM_UPDATE_FLUSH_MS = 50

type PendingStreamChunks = {
  generation: number
  content: string
  reasoning: string
}

/**
 * The pin header, or nothing at all.
 *
 * Automatic routing is the default and by far the common path, so it must send
 * no channel header whatsoever — an empty or `0` value is a request to pin a
 * channel that does not exist, which is a different thing from not asking.
 */
function buildChannelRequestHeaders(
  channelId: number | undefined
): Record<string, string> | undefined {
  if (channelId === undefined) return undefined

  return { [CHANNEL_HEADERS.REQUEST_CHANNEL_ID]: String(channelId) }
}

function mergePendingStreamChunk(
  currentChunk: string,
  nextChunk: string
): string {
  if (!currentChunk || !nextChunk.startsWith(currentChunk)) {
    return currentChunk + nextChunk
  }

  return nextChunk
}

/**
 * Hook for handling chat message sending and receiving
 */
export function useChatHandler({
  config,
  onMessageUpdate,
}: UseChatHandlerOptions) {
  const { t } = useTranslation()
  const { sendStreamRequest, stopStream, isStreaming } = useStreamRequest()
  const [isRequesting, setIsRequesting] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestGenerationRef = useRef(0)
  /**
   * The model the in-flight request was sent for, pinned at send time.
   *
   * Every write below routes here rather than to whatever model is selected when
   * the response arrives, which is what makes switching models mid-stream safe:
   * the reply lands in the transcript that asked for it. Read from a ref because
   * these callbacks are created once and outlive the switch.
   */
  const requestModelRef = useRef(config.model)
  const pendingStreamChunksRef = useRef<PendingStreamChunks>({
    generation: 0,
    content: '',
    reasoning: '',
  })
  const streamFlushTimerRef = useRef<number | null>(null)

  const discardPendingStreamUpdates = useCallback((generation: number) => {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current)
      streamFlushTimerRef.current = null
    }
    pendingStreamChunksRef.current = {
      generation,
      content: '',
      reasoning: '',
    }
  }, [])

  const flushStreamUpdates = useCallback(
    (generation: number) => {
      if (generation !== requestGenerationRef.current) return
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current)
        streamFlushTimerRef.current = null
      }

      const pendingChunks = pendingStreamChunksRef.current
      if (pendingChunks.generation !== generation) return
      if (!pendingChunks.reasoning && !pendingChunks.content) {
        return
      }

      pendingStreamChunksRef.current = {
        generation,
        content: '',
        reasoning: '',
      }
      onMessageUpdate((prev) => {
        if (generation !== requestGenerationRef.current) return prev
        return updateLastAssistantMessage(prev, (message) => {
          let updatedMessage = message

          if (pendingChunks.reasoning) {
            updatedMessage = applyStreamingChunk(
              updatedMessage,
              'reasoning',
              pendingChunks.reasoning
            )
          }

          if (pendingChunks.content) {
            updatedMessage = applyStreamingChunk(
              updatedMessage,
              'content',
              pendingChunks.content
            )
          }

          return updatedMessage
        })
      }, requestModelRef.current)
    },
    [onMessageUpdate]
  )

  const scheduleStreamFlush = useCallback(
    (generation: number) => {
      if (generation !== requestGenerationRef.current) return
      if (streamFlushTimerRef.current !== null) {
        return
      }

      streamFlushTimerRef.current = window.setTimeout(() => {
        flushStreamUpdates(generation)
      }, STREAM_UPDATE_FLUSH_MS)
    },
    [flushStreamUpdates]
  )

  useEffect(
    () => () => {
      requestGenerationRef.current += 1
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current)
      }
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    },
    []
  )

  const getDisplayError = useCallback(
    (error: string) => {
      if (KNOWN_ERROR_MESSAGES.has(error)) {
        return t(error)
      }

      const connectionClosedSuffix = `: ${ERROR_MESSAGES.CONNECTION_CLOSED}`
      if (error.endsWith(connectionClosedSuffix)) {
        return `${error.slice(0, -ERROR_MESSAGES.CONNECTION_CLOSED.length)}${t(
          ERROR_MESSAGES.CONNECTION_CLOSED
        )}`
      }

      return error
    },
    [t]
  )

  // Handle stream update
  const handleStreamUpdate = useCallback(
    (generation: number, type: 'reasoning' | 'content', chunk: string) => {
      if (generation !== requestGenerationRef.current) return
      if (pendingStreamChunksRef.current.generation !== generation) return
      pendingStreamChunksRef.current[type] = mergePendingStreamChunk(
        pendingStreamChunksRef.current[type],
        chunk
      )
      scheduleStreamFlush(generation)
    },
    [scheduleStreamFlush]
  )

  // Handle stream complete
  const handleStreamComplete = useCallback(
    (generation: number) => {
      if (generation !== requestGenerationRef.current) return
      flushStreamUpdates(generation)
      setIsRequesting(false)
      onMessageUpdate((prev) => {
        if (generation !== requestGenerationRef.current) return prev
        return updateLastAssistantMessage(prev, (message) =>
          isAssistantMessageFinal(message)
            ? message
            : completeAssistantMessage(message)
        )
      }, requestModelRef.current)
    },
    [flushStreamUpdates, onMessageUpdate]
  )

  // Handle stream error
  const handleStreamError = useCallback(
    (generation: number, error: string, errorCode?: string) => {
      if (generation !== requestGenerationRef.current) return
      flushStreamUpdates(generation)
      setIsRequesting(false)
      const displayError = getDisplayError(error)

      /*
       * Errors the message can explain are reported there only, not also as a
       * toast.
       *
       * Both used to receive the same raw backend string — for a price error,
       * Chinese and English concatenated plus a request id — so one failure
       * produced two copies of it, and the toast was the copy with no title, no
       * action and no room to wrap. `MessageError` now renders these codes as a
       * written title and sentence with the raw detail below.
       *
       * Unmapped codes keep their toast: the message shows only the same raw
       * text, and a failure can arrive while the user is looking elsewhere.
       */
      if (!hasErrorExplanation(errorCode)) {
        toast.error(displayError)
      }
      const errorTitle = t(ERROR_MESSAGES.API_REQUEST_ERROR)
      onMessageUpdate((prev) => {
        if (generation !== requestGenerationRef.current) return prev
        return updateAssistantMessageWithError(
          prev,
          displayError,
          errorCode,
          errorTitle
        )
      }, requestModelRef.current)
    },
    [flushStreamUpdates, getDisplayError, onMessageUpdate, t]
  )

  /**
   * Record which channel answered, and how fast it started.
   *
   * Both land on the pending assistant message of the transcript that asked, via
   * the same model-pinned write every chunk uses, so a model switch mid-flight
   * cannot file the reply's provenance under the wrong conversation.
   */
  const applyReplyMetadata = useCallback(
    (generation: number, patch: Partial<Message>) => {
      if (generation !== requestGenerationRef.current) return
      onMessageUpdate((prev) => {
        if (generation !== requestGenerationRef.current) return prev
        return updateLastAssistantMessage(prev, (message) => ({
          ...message,
          ...patch,
        }))
      }, requestModelRef.current)
    },
    [onMessageUpdate]
  )

  // Send streaming chat request
  const sendStreamingChat = useCallback(
    (messages: Message[]) => {
      const generation = requestGenerationRef.current + 1
      requestGenerationRef.current = generation
      requestModelRef.current = config.model
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      discardPendingStreamUpdates(generation)
      setIsRequesting(true)
      const payload = buildChatCompletionPayload(messages, config)
      void sendStreamRequest(
        payload,
        {
          onUpdate: (type, chunk) =>
            handleStreamUpdate(generation, type, chunk),
          onComplete: () => handleStreamComplete(generation),
          onError: (error, errorCode) =>
            handleStreamError(generation, error, errorCode),
          onHeaders: (headers) => {
            const channel = parseChannelEcho(headers)
            const requestId = parseRequestId(headers)
            // One write for whatever the headers yielded. Either can be absent
            // independently, and writing an explicit `undefined` would overwrite
            // a value the other transport had already recorded.
            if (channel || requestId) {
              applyReplyMetadata(generation, {
                ...(channel ? { channel } : {}),
                ...(requestId ? { requestId } : {}),
              })
            }
          },
          onFirstToken: (ttftMs) => applyReplyMetadata(generation, { ttftMs }),
          onUsage: (usage) => applyReplyMetadata(generation, { usage }),
        },
        buildChannelRequestHeaders(config.channelId)
      )
    },
    [
      config,
      sendStreamRequest,
      discardPendingStreamUpdates,
      handleStreamUpdate,
      handleStreamComplete,
      handleStreamError,
      applyReplyMetadata,
    ]
  )

  // Send non-streaming chat request
  const sendNonStreamingChat = useCallback(
    async (messages: Message[]) => {
      const payload = buildChatCompletionPayload(messages, config)
      const generation = requestGenerationRef.current + 1
      const abortController = new AbortController()

      requestGenerationRef.current = generation
      requestModelRef.current = config.model
      stopStream()
      discardPendingStreamUpdates(generation)
      abortControllerRef.current?.abort()
      abortControllerRef.current = abortController

      try {
        setIsRequesting(true)
        const result = await sendChatCompletion(
          payload,
          abortController.signal,
          buildChannelRequestHeaders(config.channelId)
        )
        if (
          abortController.signal.aborted ||
          requestGenerationRef.current !== generation
        ) {
          return
        }

        if (!hasChatCompletionChoice(result.data)) {
          handleStreamError(generation, ERROR_MESSAGES.API_REQUEST_ERROR)
          return
        }

        /*
         * No `ttftMs` on this path. A non-streaming response arrives whole, so
         * there is no first token to observe — reporting the total round trip as
         * a first-token time would invent a measurement.
         */
        const channel = parseChannelEcho(result.headers)
        const requestId = parseRequestId(result.headers)
        // Taken straight off the body on this path. A non-streaming reply carries
        // its own `usage`, so there is nothing to reassemble from chunks.
        const usage = result.data.usage

        onMessageUpdate((prev) => {
          if (requestGenerationRef.current !== generation) return prev
          return updateLastAssistantMessage(prev, (message) => {
            const updatedMessage = applyChatCompletionResponse(
              message,
              result.data
            )

            return {
              ...(updatedMessage ?? message),
              ...(channel && { channel }),
              ...(requestId && { requestId }),
              ...(usage && { usage }),
            }
          })
        }, requestModelRef.current)
      } catch (error: unknown) {
        if (
          abortController.signal.aborted ||
          requestGenerationRef.current !== generation
        ) {
          return
        }

        const { errorCode, errorMessage } = parseRequestErrorDetails(error)
        handleStreamError(generation, errorMessage, errorCode)
      } finally {
        if (requestGenerationRef.current === generation) {
          abortControllerRef.current = null
          setIsRequesting(false)
        }
      }
    },
    [
      config,
      stopStream,
      discardPendingStreamUpdates,
      onMessageUpdate,
      handleStreamError,
    ]
  )

  // Send chat request (stream or non-stream based on config)
  const sendChat = useCallback(
    (messages: Message[]) => {
      if (config.stream) {
        sendStreamingChat(messages)
      } else {
        sendNonStreamingChat(messages)
      }
    },
    [config.stream, sendStreamingChat, sendNonStreamingChat]
  )

  // Stop generation
  const stopGeneration = useCallback(() => {
    const stoppedGeneration = requestGenerationRef.current
    flushStreamUpdates(stoppedGeneration)
    const idleGeneration = stoppedGeneration + 1
    requestGenerationRef.current = idleGeneration
    discardPendingStreamUpdates(idleGeneration)
    stopStream()
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsRequesting(false)
    onMessageUpdate((prev) => {
      if (requestGenerationRef.current !== idleGeneration) return prev
      return updateLastAssistantMessage(prev, (message) =>
        isAssistantMessagePending(message)
          ? completeAssistantMessage(message)
          : message
      )
    }, requestModelRef.current)
  }, [
    stopStream,
    flushStreamUpdates,
    discardPendingStreamUpdates,
    onMessageUpdate,
  ])

  return {
    sendChat,
    stopGeneration,
    /**
     * Whether the *selected* model is waiting on a reply.
     *
     * Scoped to the owning model because a request outlives a model switch now.
     * Reporting the raw request state would leave the composer showing a stop
     * button on a model with nothing in flight, and stopping there would finalise
     * a different transcript's pending message.
     */
    isGenerating:
      (isStreaming || isRequesting) && requestModelRef.current === config.model,
  }
}
