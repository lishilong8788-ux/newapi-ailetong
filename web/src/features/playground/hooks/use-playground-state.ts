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

import { DEFAULT_CONFIG } from '../constants'
import {
  saveConfig,
  saveConversations,
  applyMessageStateUpdate,
  getInitialPlaygroundConfig,
  loadConversations,
  type MessageStateUpdater,
} from '../lib'
import type { ParamChipValues } from '../lib/parameters/param-chip-values'
import type {
  Message,
  PlaygroundConfig,
  PlaygroundConversations,
  ModelOption,
  GroupOption,
} from '../types'

const MESSAGE_SAVE_DEBOUNCE_MS = 500

/** Stable identity, so `messages` does not change on every render for a model with no history. */
const EMPTY_MESSAGES: Message[] = []

/**
 * Main state management hook for playground
 */
export function usePlaygroundState() {
  // Load initial state from localStorage
  const [config, setConfig] = useState<PlaygroundConfig>(
    getInitialPlaygroundConfig
  )

  /**
   * One transcript per model, and the active model picks which one is on screen.
   *
   * Switching models therefore swaps the canvas rather than clearing it: the
   * previous model's messages are still there when you switch back, and a reply
   * from one model never becomes context for another. The alternative — one
   * shared history — sent the whole mixed transcript upstream on the next turn,
   * which is both wrong as context and a silent cost.
   */
  const [conversations, setConversations] = useState<PlaygroundConversations>(
    {}
  )
  const [isLoadingMessages, setIsLoadingMessages] = useState(true)
  const messagesSaveTimerRef = useRef<number | null>(null)
  const latestConversationsRef = useRef<PlaygroundConversations>(conversations)
  const hasLoadedMessagesRef = useRef(false)

  /**
   * The model that owns writes, read inside the debounced save and the state
   * updaters. A ref, not a dependency: `updateMessages` is threaded into
   * memoised message components, and rebuilding it whenever the model changes
   * would defeat that memoisation on every switch.
   */
  const activeModelRef = useRef(config.model)
  activeModelRef.current = config.model

  const messages = conversations[config.model]?.messages ?? EMPTY_MESSAGES

  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])

  // Parameter chip selections. In-memory only: the image ratio chip now reaches
  // the request body via `resolveImageSize`, but a reload also drops the
  // conversation it framed, so restoring the chip alone would outlive its
  // context. See `ParamChipValues`.
  const [paramChipValues, setParamChipValues] = useState<ParamChipValues>({})

  const updateParamChip = useCallback((id: string, value: string) => {
    setParamChipValues((prev) => ({ ...prev, [id]: value }))
  }, [])

  const persistConversations = useCallback(
    (conversationsToSave: PlaygroundConversations) => {
      latestConversationsRef.current = conversationsToSave

      if (!hasLoadedMessagesRef.current) {
        return
      }

      if (messagesSaveTimerRef.current !== null) {
        window.clearTimeout(messagesSaveTimerRef.current)
      }

      messagesSaveTimerRef.current = window.setTimeout(() => {
        messagesSaveTimerRef.current = null
        saveConversations(latestConversationsRef.current)
      }, MESSAGE_SAVE_DEBOUNCE_MS)
    },
    []
  )

  useEffect(() => {
    let cancelled = false

    window.setTimeout(() => {
      // Reads the model from the ref rather than the closure: the stored config
      // resolves synchronously, but `usePlaygroundOptions` may already have
      // replaced an unavailable model by the time this fires, and the legacy
      // single history has to land under the model actually in use.
      const loaded = loadConversations(activeModelRef.current)
      if (cancelled) {
        return
      }

      latestConversationsRef.current = loaded
      hasLoadedMessagesRef.current = true
      setConversations(loaded)
      setIsLoadingMessages(false)
    }, 0)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () => () => {
      if (messagesSaveTimerRef.current !== null) {
        window.clearTimeout(messagesSaveTimerRef.current)
        saveConversations(latestConversationsRef.current)
      }
    },
    []
  )

  // Update config with automatic save
  const updateConfig = useCallback(
    <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) => {
      setConfig((prev) => {
        const updated = { ...prev, [key]: value }
        saveConfig(updated)
        return updated
      })
    },
    []
  )

  /**
   * Write to one model's transcript, with automatic save.
   *
   * `targetModel` names the transcript that owns the write, and only the async
   * request handlers pass it. They pin the model at send time, so a reply keeps
   * landing in the conversation that asked for it even after the user switches
   * away mid-flight — that pinning is what lets a switch leave the request
   * running instead of aborting it.
   *
   * Everything else omits it and gets the active model, which is what direct
   * manipulation means: editing or deleting acts on the transcript on screen.
   */
  const updateMessages = useCallback(
    (updater: MessageStateUpdater, targetModel?: string) => {
      const model = targetModel ?? activeModelRef.current

      setConversations((prev) => {
        const previousMessages = prev[model]?.messages ?? EMPTY_MESSAGES
        const newMessages = applyMessageStateUpdate(previousMessages, updater)
        if (newMessages === previousMessages) {
          return prev
        }

        const updated: PlaygroundConversations = { ...prev }
        if (newMessages.length === 0) {
          delete updated[model]
        } else {
          updated[model] = { messages: newMessages, updatedAt: Date.now() }
        }

        persistConversations(updated)
        return updated
      })
    },
    [persistConversations]
  )

  // Clear the active model's messages, leaving every other model's intact
  const clearMessages = useCallback(() => {
    updateMessages([])
  }, [updateMessages])

  // Reset config to defaults
  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG)
    saveConfig(DEFAULT_CONFIG)
  }, [])

  return {
    // State
    config,
    messages,
    isLoadingMessages,
    models,
    groups,
    paramChipValues,

    // Setters
    setModels,
    setGroups,

    // Actions
    updateConfig,
    updateMessages,
    clearMessages,
    resetConfig,
    updateParamChip,
  }
}
