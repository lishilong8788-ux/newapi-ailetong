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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  createCopilotSession,
  deleteCopilotSession,
  getCopilotModels,
  getCopilotSession,
  getCopilotSessions,
  getCopilotStatus,
  updateCopilotConfig,
} from '../api'
import {
  ERROR_MESSAGES,
  QUERY_KEY_COPILOT_MODELS,
  QUERY_KEY_COPILOT_SESSION,
  QUERY_KEY_COPILOT_SESSIONS,
  QUERY_KEY_COPILOT_STATUS,
  SUCCESS_MESSAGES,
} from '../constants'
import {
  abandonTurn,
  buildTurnsFromHistory,
  createPendingTurn,
  reduceFrame,
} from '../lib'
import type {
  CopilotAssistantTurn,
  CopilotConfigUpdate,
  CopilotTurn,
} from '../types'
import { useCopilotStream } from './use-copilot-stream'
/**
 * Everything the page needs: status, the session rail, the active transcript and
 * the send/stop pair.
 *
 * Turns are component state rather than query cache: a stream mutates the last
 * turn dozens of times per reply, and the server copy only becomes authoritative
 * once the turn is finished. The session list is a query because it *is* server
 * state, and the transcript is refetched on switch — the live turns are dropped at
 * that point on purpose, since they belong to the session being left.
 */
export function useCopilotConversation() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [turns, setTurns] = useState<CopilotTurn[]>([])
  const { send, stop, isStreaming } = useCopilotStream()
  // The turn frames are being folded into. A ref because the stream callbacks are
  // created per request and must not close over a stale turn id.
  const activeTurnIdRef = useRef<string | null>(null)

  const statusQuery = useQuery({
    queryKey: [QUERY_KEY_COPILOT_STATUS],
    queryFn: getCopilotStatus,
    staleTime: 60_000,
  })

  const sessionsQuery = useQuery({
    queryKey: [QUERY_KEY_COPILOT_SESSIONS],
    queryFn: () => getCopilotSessions(),
    staleTime: 30_000,
  })

  // The picker's options. Fetched alongside status rather than on popover open so
  // the trigger can render the pinned channel's name from the first paint instead
  // of a bare id that fills in later.
  const modelsQuery = useQuery({
    queryKey: [QUERY_KEY_COPILOT_MODELS],
    queryFn: getCopilotModels,
    staleTime: 5 * 60_000,
  })

  const historyQuery = useQuery({
    queryKey: [QUERY_KEY_COPILOT_SESSION, sessionId],
    queryFn: () => getCopilotSession(sessionId as number),
    enabled: sessionId !== null,
    staleTime: 0,
  })

  const updateActiveTurn = useCallback(
    (updater: (turn: CopilotAssistantTurn) => CopilotAssistantTurn) => {
      const turnId = activeTurnIdRef.current
      if (!turnId) return

      setTurns((previous) =>
        previous.map((turn) =>
          turn.role === 'assistant' && turn.id === turnId ? updater(turn) : turn
        )
      )
    },
    []
  )

  const loadSession = useCallback(
    async (id: number) => {
      stop()
      activeTurnIdRef.current = null
      setSessionId(id)
      setTurns([])

      const result = await queryClient.fetchQuery({
        queryKey: [QUERY_KEY_COPILOT_SESSION, id],
        queryFn: () => getCopilotSession(id),
      })
      if (!result.success || !result.data) {
        toast.error(result.message || t(ERROR_MESSAGES.SESSION_LOAD_FAILED))
        return
      }
      setTurns(buildTurnsFromHistory(result.data.messages ?? []))
    },
    [queryClient, stop, t]
  )

  const startNewSession = useCallback(() => {
    stop()
    activeTurnIdRef.current = null
    setSessionId(null)
    setTurns([])
  }, [stop])

  const deleteSession = useMutation({
    mutationFn: (id: number) => deleteCopilotSession(id),
    onSuccess: (result, id) => {
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.SESSION_DELETE_FAILED))
        return
      }
      toast.success(t(SUCCESS_MESSAGES.SESSION_DELETED))
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_COPILOT_SESSIONS],
      })
      // Deleting the session being read has to clear the pane too, otherwise the
      // transcript stays on screen with nothing behind it.
      if (id === sessionId) startNewSession()
    },
    onError: () => {
      toast.error(t(ERROR_MESSAGES.SESSION_DELETE_FAILED))
    },
  })

  const sendMessage = useCallback(
    async (message: string, images: string[] = []) => {
      const text = message.trim()
      // Text-or-images, not text-alone: a pasted report screenshot with no
      // caption is the shortest form of "what's wrong here".
      if ((!text && images.length === 0) || isStreaming) return

      // A session is created on first send rather than on page load, so opening
      // the page and leaving does not litter the rail with empty conversations.
      let targetSessionId = sessionId
      if (targetSessionId === null) {
        const created = await createCopilotSession()
        if (!created.success || !created.data) {
          toast.error(
            created.message || t(ERROR_MESSAGES.SESSION_CREATE_FAILED)
          )
          return
        }
        targetSessionId = created.data.id
        setSessionId(targetSessionId)
      }

      const turnId = `turn-${Date.now()}`
      activeTurnIdRef.current = turnId
      setTurns((previous) => [
        ...previous,
        // The local data URLs go straight into the rendered turn: the operator
        // sees the screenshot they just pasted without waiting for it to land on
        // the server and come back.
        { role: 'user', id: `user-${turnId}`, text, images },
        createPendingTurn(turnId),
      ])

      await send(targetSessionId, text, images, {
        onFrame: (frame) => {
          updateActiveTurn((turn) => reduceFrame(turn, frame))
        },
        onError: (errorMessage) => {
          updateActiveTurn((turn) => abandonTurn(turn, errorMessage))
        },
        onSettled: () => {
          // Nothing is refetched into the thread here: the rendered turn is
          // already complete, and replacing it with the stored copy would drop the
          // per-step durations, which the contract does not persist.
          updateActiveTurn((turn) => abandonTurn(turn))
          activeTurnIdRef.current = null
          void queryClient.invalidateQueries({
            queryKey: [QUERY_KEY_COPILOT_SESSIONS],
          })
        },
      })
    },
    [isStreaming, queryClient, send, sessionId, t, updateActiveTurn]
  )

  const stopStreaming = useCallback(() => {
    stop()
    updateActiveTurn((turn) => abandonTurn(turn))
    activeTurnIdRef.current = null
  }, [stop, updateActiveTurn])

  const saveConfig = useMutation({
    mutationFn: (update: CopilotConfigUpdate) => updateCopilotConfig(update),
    onSuccess: (result) => {
      if (!result.success || !result.data) {
        toast.error(result.message || t(ERROR_MESSAGES.CONFIG_SAVE_FAILED))
        // The rejected value is still sitting in the picker's field, so the cached
        // status has to be re-read for the UI to fall back to what is configured.
        void queryClient.invalidateQueries({
          queryKey: [QUERY_KEY_COPILOT_STATUS],
        })
        return
      }
      // Seeded from the response instead of refetched: the endpoint returns the
      // resulting status, and a refetch would leave the picker on the old value
      // for a round trip.
      queryClient.setQueryData([QUERY_KEY_COPILOT_STATUS], result)
      toast.success(t(SUCCESS_MESSAGES.CONFIG_SAVED))
    },
    onError: () => {
      toast.error(t(ERROR_MESSAGES.CONFIG_SAVE_FAILED))
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_COPILOT_STATUS],
      })
    },
  })

  const status = statusQuery.data?.data

  return {
    status,
    isStatusLoading: statusQuery.isLoading,
    /** False only once `/status` has answered; unknown state must not look broken. */
    isConfigured: status ? status.configured && status.enabled : true,
    sessions: sessionsQuery.data?.data?.items ?? [],
    isSessionsLoading: sessionsQuery.isLoading,
    sessionId,
    turns,
    isHistoryLoading: historyQuery.isFetching,
    isStreaming,
    loadSession,
    startNewSession,
    deleteSession: deleteSession.mutate,
    isDeletingSession: deleteSession.isPending,
    sendMessage,
    stopStreaming,
    models: modelsQuery.data?.data?.models ?? [],
    modelGroup: modelsQuery.data?.data?.group,
    isModelsLoading: modelsQuery.isLoading,
    saveConfig: saveConfig.mutate,
    isSavingConfig: saveConfig.isPending,
  }
}
