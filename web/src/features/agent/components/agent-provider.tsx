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
import { useQuery } from '@tanstack/react-query'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import useDialogState from '@/hooks/use-dialog'

import { getAgentOverview } from '../api'
import { ERROR_MESSAGES } from '../constants'
import type {
  AgentDialogType,
  AgentOverview,
  AgentWithdrawalMethod,
} from '../types'

type AgentContextType = {
  open: AgentDialogType | null
  setOpen: (dialog: AgentDialogType | null) => void
  /**
   * Withdrawal method the dialog should open on. "Transfer to balance" is the
   * same dialog pre-set to `balance`, so the shortcut only needs to carry the
   * method rather than duplicate the form.
   */
  withdrawalMethod: AgentWithdrawalMethod
  openWithdrawal: (method: AgentWithdrawalMethod) => void
  overview: AgentOverview | null
  isLoadingOverview: boolean
  refreshOverview: () => void
  /** Bumped after a mutation so dependent lists refetch. */
  refreshTrigger: number
  triggerRefresh: () => void
}

const AgentContext = React.createContext<AgentContextType | null>(null)

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useDialogState<AgentDialogType>(null)
  const [withdrawalMethod, setWithdrawalMethod] =
    useState<AgentWithdrawalMethod>('bank')
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const triggerRefresh = useCallback(() => {
    setRefreshTrigger((previous) => previous + 1)
  }, [])

  const {
    data: overview,
    isLoading: isLoadingOverview,
    refetch,
  } = useQuery({
    queryKey: ['agent-overview', refreshTrigger],
    queryFn: async () => {
      const result = await getAgentOverview()
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.OVERVIEW_FAILED))
        return null
      }
      return result.data ?? null
    },
    placeholderData: (previousData) => previousData,
  })

  const openWithdrawal = useCallback(
    (method: AgentWithdrawalMethod) => {
      setWithdrawalMethod(method)
      setOpen('withdrawal')
    },
    [setOpen]
  )

  const refreshOverview = useCallback(() => {
    void refetch()
  }, [refetch])

  return (
    <AgentContext
      value={{
        open,
        setOpen,
        withdrawalMethod,
        openWithdrawal,
        overview: overview ?? null,
        isLoadingOverview,
        refreshOverview,
        refreshTrigger,
        triggerRefresh,
      }}
    >
      {children}
    </AgentContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAgent = () => {
  const agentContext = React.useContext(AgentContext)

  if (!agentContext) {
    throw new Error('useAgent has to be used within <AgentProvider>')
  }

  return agentContext
}
