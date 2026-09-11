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
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { AgentAuditDialog } from './components/agent-audit-dialog'
import { AgentDetailSheet } from './components/agent-detail-sheet'
import { AgentRateDialog } from './components/agent-rate-dialog'
import { AgentsProvider } from './components/agents-provider'
import { AgentsTable } from './components/agents-table'
import { CommissionAdjustDialog } from './components/commission-adjust-dialog'
import { CommissionsTable } from './components/commissions-table'
import { WithdrawalAuditDialog } from './components/withdrawal-audit-dialog'
import { WithdrawalCompleteDialog } from './components/withdrawal-complete-dialog'
import { WithdrawalDetailSheet } from './components/withdrawal-detail-sheet'
import { WithdrawalsTable } from './components/withdrawals-table'
import {
  AGENT_MANAGEMENT_TAB_DEFAULT,
  AGENT_MANAGEMENT_TAB_LABEL_KEYS,
} from './constants'
import { AGENT_MANAGEMENT_TABS, type AgentManagementTab } from './types'

const route = getRouteApi('/_authenticated/agent-management/')

function isAgentManagementTab(value: string): value is AgentManagementTab {
  return (AGENT_MANAGEMENT_TABS as readonly string[]).includes(value)
}

export function AgentManagement() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()

  const rawTab = search.tab ?? ''
  const activeTab = isAgentManagementTab(rawTab)
    ? rawTab
    : AGENT_MANAGEMENT_TAB_DEFAULT

  return (
    <AgentsProvider>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Agent Management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <Tabs
            className='flex h-full min-h-0 flex-col gap-3'
            value={activeTab}
            onValueChange={(value) => {
              // The three queues share the page's `status`/`method`/`keyword`
              // params but read them differently, so a stale filter from the
              // previous tab would silently hide rows on the next one.
              navigate({
                search: (previous) => ({
                  ...previous,
                  tab: value,
                  page: undefined,
                  keyword: undefined,
                  status: undefined,
                  method: undefined,
                }),
              })
            }}
          >
            <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto sm:group-data-horizontal/tabs:h-9'>
              {AGENT_MANAGEMENT_TABS.map((tab) => (
                <TabsTrigger key={tab} value={tab} className='px-3'>
                  {t(AGENT_MANAGEMENT_TAB_LABEL_KEYS[tab])}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Only the active queue is mounted: all three tables drive the same
                URL keys, so keeping two alive would make them fight over the
                page and page-size params. */}
            <div className='flex min-h-0 flex-1 flex-col'>
              {activeTab === 'agents' && <AgentsTable />}
              {activeTab === 'withdrawals' && <WithdrawalsTable />}
              {activeTab === 'commissions' && <CommissionsTable />}
            </div>
          </Tabs>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <AgentDetailSheet />
      <AgentAuditDialog />
      <AgentRateDialog />
      <WithdrawalDetailSheet />
      <WithdrawalAuditDialog />
      <WithdrawalCompleteDialog />
      <CommissionAdjustDialog />
    </AgentsProvider>
  )
}
