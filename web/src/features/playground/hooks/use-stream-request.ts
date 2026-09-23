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
import { SSE } from 'sse.js'

import { getFreshAuthHeaders } from '@/lib/api'

import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants'
import {
  getStreamReadyStateError,
  isStreamClosedReadyState,
  isStreamDoneMessage,
  parseStreamErrorDetails,
  parseStreamMessageUpdates,
  parseStreamUsage,
} from '../lib'
import type { ChatCompletionRequest, Message } from '../types'

/**
 * The `sse.js` surface this module uses.
 *
 * `headers` rides on the `open` event: `sse.js` parses the response headers once
 * the underlying `XMLHttpRequest` reaches `HEADERS_RECEIVED`, lowercases every
 * key and wraps each value in an array (`sse.js/lib/sse.js`, `_onReadyStateChange`).
 * It is not on `readystatechange` — that event carries only `readyState`, and
 * `sse.js` numbers its own states (`INITIALIZING -1`, `CONNECTING 0`, `OPEN 1`,
 * `CLOSED 2`) rather than the XHR's, so `readyState === 2` there means the stream
 * has closed.
 */
interface StreamEventSource {
  readyState?: number
  addEventListener: (
    type: string,
    listener: (
      event: Event & {
        data?: string
        readyState?: number
        headers?: Record<string, string[]>
      }
    ) => void
  ) => void
  close: () => void
  stream: () => void
}

export interface StreamRequestCallbacks {
  onUpdate: (type: 'reasoning' | 'content', chunk: string) => void
  onComplete: () => void
  onError: (error: string, errorCode?: string) => void
  /** Response headers, flattened to one value per key, keys lowercased. */
  onHeaders?: (headers: Record<string, string>) => void
  /**
   * Time to first token in ms, measured from the moment this request was put on
   * the wire. Fires at most once per request. See `dispatchedAt` below for why
   * the controller owns this measurement.
   */
  onFirstToken?: (ttftMs: number) => void
  /**
   * Token counts from the stream's closing usage frame.
   *
   * Fires at most once in practice, but not enforced: if an upstream sent two,
   * the later figure is the more complete one and overwriting is correct.
   */
  onUsage?: (usage: Message['usage']) => void
}

interface StreamRequestControllerRuntime {
  getHeaders: () => Promise<Record<string, string>>
  createSource: (
    payload: ChatCompletionRequest,
    headers: Record<string, string>
  ) => StreamEventSource
  setStreaming: (streaming: boolean) => void
}

export function createStreamRequestController(
  runtime: StreamRequestControllerRuntime
) {
  let source: StreamEventSource | null = null
  let generation = 0

  const closeActiveSource = (target: StreamEventSource) => {
    target.close()
    if (source === target) {
      source = null
      runtime.setStreaming(false)
    }
  }

  const send = async (
    payload: ChatCompletionRequest,
    callbacks: StreamRequestCallbacks,
    requestHeaders?: Record<string, string>
  ) => {
    const requestGeneration = generation + 1
    generation = requestGeneration
    const previousSource = source
    source = null
    previousSource?.close()
    runtime.setStreaming(false)

    let headers: Record<string, string>
    try {
      headers = await runtime.getHeaders()
    } catch (error: unknown) {
      if (generation !== requestGeneration) return
      callbacks.onError(
        error instanceof Error
          ? error.message
          : ERROR_MESSAGES.STREAM_START_ERROR
      )
      return
    }
    if (generation !== requestGeneration) return

    const nextSource = runtime.createSource(
      payload,
      requestHeaders ? { ...headers, ...requestHeaders } : headers
    )
    source = nextSource
    runtime.setStreaming(true)
    let completed = false
    /*
     * When this request went on the wire, and the start of the first-token
     * measurement.
     *
     * Set right before `stream()` rather than at submit time: the message's
     * `startedAt` is stamped when the user/assistant pair is appended, which is
     * before this function is even called and before `getHeaders()` — a call that
     * silently becomes a token-refresh round trip when the access token is near
     * expiry. Measuring from there would charge that refresh to the upstream's
     * first token and report a number the channel card can never match.
     */
    let dispatchedAt: number | undefined
    let firstTokenReported = false

    const isCurrent = () =>
      generation === requestGeneration && source === nextSource

    const handleError = (errorMessage: string, errorCode?: string) => {
      if (!isCurrent() || completed) return
      completed = true
      callbacks.onError(errorMessage, errorCode)
      closeActiveSource(nextSource)
    }

    nextSource.addEventListener('message', (event) => {
      if (!isCurrent() || completed) return
      const data = event.data ?? ''
      if (isStreamDoneMessage(data)) {
        completed = true
        closeActiveSource(nextSource)
        callbacks.onComplete()
        return
      }

      /*
       * First token, on the same terms the backend uses.
       *
       * `relay/helper/stream_scanner.go` calls `SetFirstResponseTime()` on the
       * first upstream SSE frame that is not `[DONE]`, without parsing it, and
       * `pkg/perf_metrics.RecordRelaySample` turns that into
       * `FirstResponseTime - StartTime` for streaming requests only. So the
       * published figure counts *any* first frame — a `reasoning_content` delta,
       * and equally an opening `role` delta carrying no text.
       *
       * This fires on the same event for that reason. Scoring only `content`, or
       * waiting for a frame that parses into something, would time a later event
       * than the channel card does and make the panel's comparison meaningless —
       * the two numbers are only worth showing side by side if they measure the
       * same thing. `[DONE]` is already handled above, so this is exactly the
       * backend's trigger.
       *
       * Deliberately before `parseStreamMessageUpdates`: a frame that fails to
       * parse still arrived, and the backend counted it.
       */
      if (!firstTokenReported && dispatchedAt !== undefined) {
        firstTokenReported = true
        callbacks.onFirstToken?.(Math.max(0, Date.now() - dispatchedAt))
      }

      // Outside the try below, and before it: the usage frame carries an empty
      // `choices`, so it is precisely the frame the message parser treats as
      // having nothing in it. Reading it first means a token count survives even
      // if that parser goes on to reject the same frame.
      const usage = parseStreamUsage(data)
      if (usage) {
        callbacks.onUsage?.(usage)
      }

      try {
        const updates = parseStreamMessageUpdates(data)

        for (const update of updates) {
          callbacks.onUpdate(update.type, update.chunk)
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to parse SSE message:', error)
        handleError(ERROR_MESSAGES.PARSE_ERROR)
      }
    })

    nextSource.addEventListener('error', (event) => {
      if (!isCurrent() || completed) return
      if (!isStreamClosedReadyState(nextSource.readyState)) {
        // eslint-disable-next-line no-console
        console.error('SSE Error:', event)
        const { errorCode, errorMessage } = parseStreamErrorDetails(event.data)
        handleError(errorMessage, errorCode)
      }
    })

    nextSource.addEventListener('readystatechange', (event) => {
      if (!isCurrent() || completed) return
      const errorMessage = getStreamReadyStateError(
        event.readyState,
        nextSource
      )

      if (errorMessage) {
        handleError(errorMessage)
      }
    })

    /*
     * Response headers, once. Flattened to the first value per key because every
     * header this reads is single-valued; `sse.js` arrays them unconditionally.
     */
    nextSource.addEventListener('open', (event) => {
      if (!isCurrent() || completed || !event.headers) return

      const flattened: Record<string, string> = {}
      for (const [name, values] of Object.entries(event.headers)) {
        const value = values[0]
        if (value !== undefined) flattened[name] = value
      }

      callbacks.onHeaders?.(flattened)
    })

    try {
      if (!isCurrent()) return
      dispatchedAt = Date.now()
      nextSource.stream()
    } catch (error: unknown) {
      if (!isCurrent() || completed) return
      // eslint-disable-next-line no-console
      console.error('Failed to start SSE stream:', error)
      handleError(ERROR_MESSAGES.STREAM_START_ERROR)
    }
  }

  const cancel = (notify: boolean) => {
    generation += 1
    const activeSource = source
    source = null
    activeSource?.close()
    if (notify) runtime.setStreaming(false)
  }

  const stop = () => cancel(true)
  const dispose = () => cancel(false)

  return { send, stop, dispose }
}

/**
 * Hook for handling streaming chat completion requests
 */
export function useStreamRequest() {
  const [isStreaming, setIsStreaming] = useState(false)
  const controllerRef = useRef<ReturnType<
    typeof createStreamRequestController
  > | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = createStreamRequestController({
      getHeaders: getFreshAuthHeaders,
      createSource: (payload, headers) =>
        new SSE(API_ENDPOINTS.CHAT_COMPLETIONS, {
          headers,
          method: 'POST',
          payload: JSON.stringify(payload),
        }) as StreamEventSource,
      setStreaming: setIsStreaming,
    })
  }

  /**
   * `callbacks` as one object rather than positional arguments: there are five of
   * them now, two optional, and a call site passing four arrows in a fixed order
   * had already stopped being readable.
   */
  const sendStreamRequest = useCallback(
    (
      payload: ChatCompletionRequest,
      callbacks: StreamRequestCallbacks,
      requestHeaders?: Record<string, string>
    ) => controllerRef.current?.send(payload, callbacks, requestHeaders),
    []
  )

  const stopStream = useCallback(() => {
    controllerRef.current?.stop()
  }, [])

  useEffect(
    () => () => {
      controllerRef.current?.dispose()
    },
    []
  )

  return {
    sendStreamRequest,
    stopStream,
    isStreaming,
  }
}
