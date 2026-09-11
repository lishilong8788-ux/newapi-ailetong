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
import React, { useState } from 'react'

import useDialogState from '@/hooks/use-dialog'

import type { AgentListItem, AgentsDialogType, AgentWithdrawal } from '../types'

type AgentsContextType = {
  open: AgentsDialogType | null
  setOpen: (dialog: AgentsDialogType | null) => void
  /** Agent the open agent-scoped dialog acts on. */
  currentAgent: AgentListItem | null
  setCurrentAgent: React.Dispatch<React.SetStateAction<AgentListItem | null>>
  /** Withdrawal the open withdrawal-scoped dialog acts on. */
  currentWithdrawal: AgentWithdrawal | null
  setCurrentWithdrawal: React.Dispatch<
    React.SetStateAction<AgentWithdrawal | null>
  >
  /**
   * Rows a batch dialog will act on. Held here rather than read off the table so
   * the confirmation can state the blast radius even after the row selection is
   * cleared.
   */
  batchAgents: AgentListItem[]
  setBatchAgents: React.Dispatch<React.SetStateAction<AgentListItem[]>>
  /** Whether the audit dialog is approving or rejecting. */
  auditApproval: boolean
  setAuditApproval: React.Dispatch<React.SetStateAction<boolean>>
  refreshTrigger: number
  triggerRefresh: () => void
}

const AgentsContext = React.createContext<AgentsContextType | null>(null)

export function AgentsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useDialogState<AgentsDialogType>(null)
  const [currentAgent, setCurrentAgent] = useState<AgentListItem | null>(null)
  const [currentWithdrawal, setCurrentWithdrawal] =
    useState<AgentWithdrawal | null>(null)
  const [batchAgents, setBatchAgents] = useState<AgentListItem[]>([])
  const [auditApproval, setAuditApproval] = useState(true)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const triggerRefresh = () => setRefreshTrigger((previous) => previous + 1)

  return (
    <AgentsContext
      value={{
        open,
        setOpen,
        currentAgent,
        setCurrentAgent,
        currentWithdrawal,
        setCurrentWithdrawal,
        batchAgents,
        setBatchAgents,
        auditApproval,
        setAuditApproval,
        refreshTrigger,
        triggerRefresh,
      }}
    >
      {children}
    </AgentsContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAgents = () => {
  const agentsContext = React.useContext(AgentsContext)

  if (!agentsContext) {
    throw new Error('useAgents has to be used within <AgentsProvider>')
  }

  return agentsContext
}
