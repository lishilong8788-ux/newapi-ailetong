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
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { Agent } from '@/features/agent'
import { ensureStatus } from '@/lib/status-query'

const agentSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(10),
  keyword: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/agent/')({
  // Every endpoint behind this page goes through requireAgentProgramme, so with
  // the programme off the workbench can only render empty cards over a rejected
  // request. Bounce to the console instead of letting people in to read an
  // error. The admin console is deliberately still reachable — an operator who
  // switches the programme off has commission and withdrawals left to settle.
  beforeLoad: async ({ context }) => {
    const status = await ensureStatus(context.queryClient)
    if (status?.agent_enabled !== true) {
      throw redirect({ to: '/' })
    }
  },
  validateSearch: agentSearchSchema,
  component: Agent,
})
