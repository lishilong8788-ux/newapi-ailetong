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

import { getCopilotChatUrl } from '../api'
import { ERROR_MESSAGES } from '../constants'
import { parseCopilotFrame } from '../lib'
import type { CopilotFrame } from '../types'

/**
 * The `sse.js` surface this hook uses, mirroring the playground's transport.
 *
 * Two behaviours matter and neither is guessable: `sse.js` numbers its own states
 * (`INITIALIZING -1`, `CONNECTING 0`, `OPEN 1`, `CLOSED 2`), so a `readyState` of
 * 2 on its `error`/`readystatechange` events means the stream has *closed* — not
 * the XHR's `HEADERS_RECEIVED`; and response headers ride on `open`, not on
 * `readystatechange`. This endpoint needs no headers, so only the first applies:
 * an `error` fired while already closed is the normal end of a stream and must not
 * be reported as a failure.
 */
interface CopilotEventSource {
  readyState?: number
  addEventListener: (
    type: string,
    listener: (event: Event & { data?: string }) => void
  ) => void
  close: () => void
  stream: () => void
}

const SSE_CLOSED = 2

export interface CopilotStreamCallbacks {
  onFrame: (frame: CopilotFrame) => void
  /** Transport-level failure. Frame-level `{type:"error"}` arrives via `onFrame`. */
  onError: (message: string) => void
  /** Fires exactly once per request, on any terminal outcome including abort. */
  onSettled: () => void
}

/**
 * Posts one message to a session and streams the reply back as frames.
 *
 * `sse.js` rather than `fetch` + `ReadableStream` because this repo already ships
 * it for the playground's POST-with-body stream and it carries the auth header
 * refresh with it; introducing a second transport for the same job would mean two
 * places to get the abort semantics wrong.
 */
export function useCopilotStream() {
  const [isStreaming, setIsStreaming] = useState(false)
  const sourceRef = useRef<CopilotEventSource | null>(null)
  const generationRef = useRef(0)

  const closeSource = useCallback(() => {
    const active = sourceRef.current
    sourceRef.current = null
    active?.close()
  }, [])

  const send = useCallback(
    async (
      sessionId: number,
      message: string,
      images: string[],
      callbacks: CopilotStreamCallbacks,
      options?: { mode?: string; approvedTool?: string }
    ) => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      closeSource()
      setIsStreaming(true)

      let headers: Record<string, string>
      try {
        headers = await getFreshAuthHeaders()
      } catch (error: unknown) {
        if (generationRef.current !== generation) return
        setIsStreaming(false)
        callbacks.onError(
          error instanceof Error ? error.message : ERROR_MESSAGES.STREAM_START
        )
        callbacks.onSettled()
        return
      }
      if (generationRef.current !== generation) return

      // Images ride along in this body as data URLs; the server writes them to
      // disk in the same request that stores the message. There is no separate
      // upload endpoint on purpose — that would leave "uploaded but never sent"
      // files behind with nothing to collect them.
      const source = new SSE(getCopilotChatUrl(sessionId), {
        headers,
        method: 'POST',
        payload: JSON.stringify({
          message,
          ...(images.length > 0 ? { images } : {}),
          ...(options?.mode ? { mode: options.mode } : {}),
          // Sent only on the replay that follows an approval. Omitted otherwise
          // so an ordinary turn can never carry a stale approval forward.
          ...(options?.approvedTool
            ? { approved_tool: options.approvedTool }
            : {}),
        }),
      }) as CopilotEventSource
      sourceRef.current = source

      let settled = false
      const isCurrent = () =>
        generationRef.current === generation && sourceRef.current === source

      const settle = () => {
        if (settled) return
        settled = true
        if (sourceRef.current === source) {
          sourceRef.current = null
          setIsStreaming(false)
        }
        source.close()
        callbacks.onSettled()
      }

      source.addEventListener('message', (event) => {
        if (!isCurrent() || settled) return
        const frame = parseCopilotFrame(event.data ?? '')
        if (!frame) return

        callbacks.onFrame(frame)
        // The server closes after either, but waiting for the socket to notice
        // would leave the composer on its stop button for the round trip.
        if (frame.type === 'done' || frame.type === 'error') settle()
      })

      source.addEventListener('error', (event) => {
        if (!isCurrent() || settled) return
        if (source.readyState === SSE_CLOSED) {
          // Already closed: this is the stream ending, not a failure.
          settle()
          return
        }

        const frame = parseCopilotFrame(event.data ?? '')
        if (frame?.type === 'error') {
          callbacks.onFrame(frame)
        } else {
          callbacks.onError(ERROR_MESSAGES.STREAM_CLOSED)
        }
        settle()
      })

      try {
        source.stream()
      } catch {
        if (!isCurrent() || settled) return
        callbacks.onError(ERROR_MESSAGES.STREAM_START)
        settle()
      }
    },
    [closeSource]
  )

  /** Aborts the connection. The caller closes the turn it was writing into. */
  const stop = useCallback(() => {
    generationRef.current += 1
    closeSource()
    setIsStreaming(false)
  }, [closeSource])

  useEffect(
    () => () => {
      generationRef.current += 1
      sourceRef.current?.close()
      sourceRef.current = null
    },
    []
  )

  return { send, stop, isStreaming }
}
