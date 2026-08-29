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

import { fetchVideoTask, submitVideoTask } from '../api'
import { ERROR_MESSAGES } from '../constants'
import {
  completeAssistantMessage,
  parseRequestErrorDetails,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
} from '../lib'
import type { ParamChipValues } from '../lib/parameters/param-chip-values'
import {
  extractTaskId,
  isVideoTaskSuccessful,
  parseVideoTaskState,
} from '../lib/task/video-task'
import type { Message, PlaygroundConfig } from '../types'

type UseVideoHandlerOptions = {
  config: PlaygroundConfig
  paramChipValues: ParamChipValues
  onMessageUpdate: (
    updater: (prev: Message[]) => Message[],
    targetModel?: string
  ) => void
}

/**
 * Polling cadence. Video generation runs for minutes, not seconds.
 *
 * Starts responsive so a fast failure surfaces quickly, then backs off so a
 * five-minute render is not 150 requests. The ceiling matters more than the
 * floor: the page may sit open on a task nobody is watching.
 */
const POLL_INTERVAL_START_MS = 2000
const POLL_INTERVAL_MAX_MS = 8000
const POLL_BACKOFF_FACTOR = 1.4

/**
 * How long to keep asking before giving up on the client side.
 *
 * The task itself is unaffected — it lives on the backend and can be read from
 * the task log afterwards. This only bounds how long this page waits.
 */
const POLL_DEADLINE_MS = 10 * 60 * 1000

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

function resolveVideoSize(values: ParamChipValues): string | undefined {
  const resolution = values.resolution
  if (resolution === '480p') return '854x480'
  if (resolution === '720p') return '1280x720'

  return undefined
}

function resolveDuration(values: ParamChipValues): number | undefined {
  const parsed = Number.parseInt(values.duration ?? '', 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Video generation: submit a task, then poll it.
 *
 * The third shape after chat (streamed) and image (one response). What is
 * different here is that the useful reply arrives on a *later* request than the
 * one that started the work, so the abort controller has to cover the whole
 * sequence rather than a single call.
 */
export function useVideoHandler({
  config,
  paramChipValues,
  onMessageUpdate,
}: UseVideoHandlerOptions) {
  const { t } = useTranslation()
  const [isRequesting, setIsRequesting] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestGenerationRef = useRef(0)
  /**
   * The model this task was submitted for, pinned at submit time.
   *
   * Load-bearing here more than anywhere else: a video runs for minutes, so
   * switching models mid-task is the expected behaviour rather than the edge
   * case. See the same ref in `useChatHandler`.
   */
  const requestModelRef = useRef(config.model)

  useEffect(
    () => () => {
      requestGenerationRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    },
    []
  )

  const isCurrent = useCallback(
    (generation: number, signal: AbortSignal) =>
      !signal.aborted && requestGenerationRef.current === generation,
    []
  )

  /** Writes progress onto the pending message without finalising it. */
  const reportProgress = useCallback(
    (progress: number | undefined) => {
      onMessageUpdate(
        (prev) =>
          updateLastAssistantMessage(prev, (message) =>
            message.taskProgress === progress
              ? message
              : { ...message, taskProgress: progress }
          ),
        requestModelRef.current
      )
    },
    [onMessageUpdate]
  )

  const reportError = useCallback(
    (errorMessage: string, errorCode?: string) => {
      toast.error(errorMessage)
      onMessageUpdate(
        (prev) =>
          // The task markers are cleared as well as the status set: the loader is
          // status-gated so a stale flag renders nothing, but it would otherwise
          // be persisted and reloaded on a message that is finished.
          updateAssistantMessageWithError(
            updateLastAssistantMessage(prev, (message) => ({
              ...message,
              isTaskPending: undefined,
              taskProgress: undefined,
            })),
            errorMessage,
            errorCode,
            t(ERROR_MESSAGES.API_REQUEST_ERROR)
          ),
        requestModelRef.current
      )
    },
    [onMessageUpdate, t]
  )

  /**
   * Ask until the task settles, the deadline passes, or the caller aborts.
   *
   * Returns the finished state, or null when polling stopped for a reason the
   * caller has already handled (abort, superseded generation).
   */
  const pollUntilSettled = useCallback(
    async (taskId: string, generation: number, signal: AbortSignal) => {
      const deadline = Date.now() + POLL_DEADLINE_MS
      let interval = POLL_INTERVAL_START_MS

      while (Date.now() < deadline) {
        await sleep(interval, signal)
        if (!isCurrent(generation, signal)) return null

        const state = parseVideoTaskState(await fetchVideoTask(taskId, signal))
        if (!isCurrent(generation, signal)) return null

        if (state.isTerminal) return state

        reportProgress(state.progress)
        interval = Math.min(
          POLL_INTERVAL_MAX_MS,
          Math.round(interval * POLL_BACKOFF_FACTOR)
        )
      }

      return 'timeout' as const
    },
    [isCurrent, reportProgress]
  )

  const sendVideo = useCallback(
    async (prompt: string) => {
      const generation = requestGenerationRef.current + 1
      requestGenerationRef.current = generation
      requestModelRef.current = config.model
      abortControllerRef.current?.abort()

      const abortController = new AbortController()
      abortControllerRef.current = abortController
      const { signal } = abortController

      try {
        setIsRequesting(true)
        // Before the submit resolves, so the waiting state reads as "generating
        // video" from the first frame rather than switching wording on the first
        // poll.
        onMessageUpdate(
          (prev) =>
            updateLastAssistantMessage(prev, (message) => ({
              ...message,
              isTaskPending: true,
            })),
          requestModelRef.current
        )

        const submitted = await submitVideoTask(
          {
            model: config.model,
            group: config.group,
            prompt,
            duration: resolveDuration(paramChipValues),
            size: resolveVideoSize(paramChipValues),
          },
          signal
        )
        if (!isCurrent(generation, signal)) return

        const taskId = extractTaskId(submitted)
        if (!taskId) {
          // The submission was accepted but carried no id, so there is nothing
          // to poll. Reported rather than retried: a resubmit would risk paying
          // for a second task while the first one runs unattended.
          reportError(t(ERROR_MESSAGES.API_REQUEST_ERROR))
          return
        }

        const settled = await pollUntilSettled(taskId, generation, signal)
        if (settled === null || !isCurrent(generation, signal)) return

        if (settled === 'timeout') {
          reportError(t('Still generating. Check the task log for the result.'))
          return
        }

        if (!isVideoTaskSuccessful(settled)) {
          reportError(
            settled.failReason ?? t(ERROR_MESSAGES.API_REQUEST_ERROR)
          )
          return
        }

        onMessageUpdate(
          (prev) =>
            updateLastAssistantMessage(prev, (message) =>
              completeAssistantMessage({
                ...message,
                isTaskPending: undefined,
                taskProgress: undefined,
                videos: [settled.resultUrl as string],
              })
            ),
          requestModelRef.current
        )
      } catch (error: unknown) {
        if (!isCurrent(generation, signal)) return

        const { errorCode, errorMessage } = parseRequestErrorDetails(error)
        reportError(errorMessage, errorCode)
      } finally {
        if (requestGenerationRef.current === generation) {
          abortControllerRef.current = null
          setIsRequesting(false)
        }
      }
    },
    [
      config.group,
      config.model,
      isCurrent,
      onMessageUpdate,
      paramChipValues,
      pollUntilSettled,
      reportError,
      t,
    ]
  )

  /**
   * Stop watching. The task itself keeps running upstream and stays billed —
   * there is no cancel API here, so claiming otherwise would be a lie.
   */
  const stopVideo = useCallback(() => {
    requestGenerationRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsRequesting(false)
    onMessageUpdate(
      (prev) =>
        updateLastAssistantMessage(prev, (message) =>
          completeAssistantMessage({
            ...message,
            isTaskPending: undefined,
            taskProgress: undefined,
          })
        ),
      requestModelRef.current
    )
  }, [onMessageUpdate])

  return {
    sendVideo,
    stopVideo,
    // Scoped to the owning model, for the reason given on `isGenerating` in
    // `useChatHandler`.
    isGeneratingVideo: isRequesting && requestModelRef.current === config.model,
  }
}
