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

import { sendImageGeneration } from '../api'
import { ERROR_MESSAGES } from '../constants'
import {
  completeAssistantMessage,
  parseRequestErrorDetails,
  resolveImageSize,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
} from '../lib'
import type { ParamChipValues } from '../lib/parameters/param-chip-values'
import type { Message, PlaygroundConfig } from '../types'

type UseImageHandlerOptions = {
  config: PlaygroundConfig
  paramChipValues: ParamChipValues
  onMessageUpdate: (
    updater: (prev: Message[]) => Message[],
    targetModel?: string
  ) => void
}

/**
 * Turn one upstream image entry into something `<img src>` accepts.
 *
 * The response carries either a hosted `url` or inline base64 depending on the
 * channel, and `b64_json` is bare base64 with no data-URL prefix.
 */
function toDisplayableImage(entry: {
  url?: string
  b64_json?: string
}): string | null {
  if (entry.url) return entry.url
  if (entry.b64_json) return `data:image/png;base64,${entry.b64_json}`

  return null
}

/**
 * Image generation, the non-streaming sibling of `useChatHandler`.
 *
 * The same generation-counter guard: a reply that arrives after the user has
 * switched models or sent again is discarded rather than written into whatever
 * conversation is now on screen.
 */
export function useImageHandler({
  config,
  paramChipValues,
  onMessageUpdate,
}: UseImageHandlerOptions) {
  const { t } = useTranslation()
  const [isRequesting, setIsRequesting] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestGenerationRef = useRef(0)
  /**
   * The model the in-flight generation was sent for, pinned at send time — see
   * the same ref in `useChatHandler`. Image generation makes the switch more
   * likely, not less: a minute of waiting is exactly when someone goes looking at
   * another model.
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

  const sendImage = useCallback(
    async (prompt: string) => {
      const generation = requestGenerationRef.current + 1
      requestGenerationRef.current = generation
      requestModelRef.current = config.model
      abortControllerRef.current?.abort()

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        setIsRequesting(true)
        const response = await sendImageGeneration(
          {
            model: config.model,
            group: config.group,
            prompt,
            size: resolveImageSize(paramChipValues),
          },
          abortController.signal
        )

        if (
          abortController.signal.aborted ||
          requestGenerationRef.current !== generation
        ) {
          return
        }

        const results = (response.data ?? [])
          .map(toDisplayableImage)
          .filter((image): image is string => image !== null)

        if (results.length === 0) {
          const message = t(ERROR_MESSAGES.API_REQUEST_ERROR)
          toast.error(message)
          onMessageUpdate(
            (prev) =>
              updateAssistantMessageWithError(
                prev,
                message,
                undefined,
                t(ERROR_MESSAGES.API_REQUEST_ERROR)
              ),
            requestModelRef.current
          )
          return
        }

        onMessageUpdate((prev) => {
          if (requestGenerationRef.current !== generation) return prev

          return updateLastAssistantMessage(prev, (message) =>
            completeAssistantMessage({ ...message, results })
          )
        }, requestModelRef.current)
      } catch (error: unknown) {
        if (
          abortController.signal.aborted ||
          requestGenerationRef.current !== generation
        ) {
          return
        }

        const { errorCode, errorMessage } = parseRequestErrorDetails(error)
        toast.error(errorMessage)
        onMessageUpdate(
          (prev) =>
            updateAssistantMessageWithError(
              prev,
              errorMessage,
              errorCode,
              t(ERROR_MESSAGES.API_REQUEST_ERROR)
            ),
          requestModelRef.current
        )
      } finally {
        if (requestGenerationRef.current === generation) {
          abortControllerRef.current = null
          setIsRequesting(false)
        }
      }
    },
    [config.group, config.model, onMessageUpdate, paramChipValues, t]
  )

  const stopImage = useCallback(() => {
    requestGenerationRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsRequesting(false)
    onMessageUpdate(
      (prev) => updateLastAssistantMessage(prev, completeAssistantMessage),
      requestModelRef.current
    )
  }, [onMessageUpdate])

  return {
    sendImage,
    stopImage,
    // Scoped to the owning model, for the reason given on `isGenerating` in
    // `useChatHandler`.
    isGeneratingImage: isRequesting && requestModelRef.current === config.model,
  }
}
