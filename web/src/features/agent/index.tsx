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
import { Link } from '@tanstack/react-router'
import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useStatus } from '@/hooks/use-status'

import { AgentApplication } from './components/agent-application'
import { AgentProvider, useAgent } from './components/agent-provider'
import { CustomersTable } from './components/customers-table'
import { CommissionsSheet } from './components/dialogs/commissions-sheet'
import { ProfileFormDialog } from './components/dialogs/profile-form-dialog'
import { WithdrawalDialog } from './components/dialogs/withdrawal-dialog'
import { WithdrawalsSheet } from './components/dialogs/withdrawals-sheet'
import { EarningsCard } from './components/earnings-card'
import { IdentityCard } from './components/identity-card'
import { LegacyRewardsCard } from './components/legacy-rewards-card'
import { PromoLinkCard } from './components/promo-link-card'
import { QrcodeCard } from './components/qrcode-card'

/**
 * Picks the application screen or the workbench once the overview is known.
 *
 * This has to sit inside the provider: which of the two the visitor gets depends
 * on their profile, and the profile arrives with the overview. Promotion is
 * gated on review having passed, so the workbench is reachable only from
 * `active` / `suspended` — every earlier state, including having never applied,
 * lands on the application screen, where there is no promo link to show.
 *
 * `LegacyRewardsCard` hangs off both branches: a long-standing user can be
 * sitting on an unspent sign-up-reward balance without ever having applied to be
 * an agent.
 */
function AgentContent() {
  const { t } = useTranslation()
  const { overview, isLoadingOverview, refreshOverview } = useAgent()

  if (isLoadingOverview && !overview) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Referral Program')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <Card data-card-hover='false' className='py-0'>
            <CardContent className='space-y-4 p-4 sm:p-6'>
              <Skeleton className='h-10 w-64' />
              <div className='grid gap-2.5 sm:grid-cols-3'>
                <Skeleton className='h-16 rounded-lg' />
                <Skeleton className='h-16 rounded-lg' />
                <Skeleton className='h-16 rounded-lg' />
              </div>
              <Skeleton className='h-24' />
              <Skeleton className='h-9' />
            </CardContent>
          </Card>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  // The overview query swallows its failure: the provider's queryFn toasts and
  // returns null, so a finished load with nothing to show is the error signal.
  // It has to be told apart from "has never applied" — both leave `profile`
  // unreadable, but telling an approved agent they are not an agent is a far
  // worse lie than showing a retry.
  if (!isLoadingOverview && !overview) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Referral Program')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <EmptyState
            icon={Share2}
            title={t('Could not load the referral program')}
            description={t(
              'Your agent status is unknown right now, so nothing is shown rather than guessing. Retry in a moment.'
            )}
            action={
              <Button size='sm' onClick={refreshOverview}>
                {t('Retry')}
              </Button>
            }
            bordered
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  const status = overview?.profile?.status
  const isApproved = status === 'active' || status === 'suspended'

  if (!isApproved) {
    return (
      <>
        <SectionPageLayout>
          <SectionPageLayout.Title>
            {t('Referral Program')}
          </SectionPageLayout.Title>
          <SectionPageLayout.Content>
            <div className='mx-auto flex w-full max-w-3xl flex-col gap-4'>
              <AgentApplication />
              <LegacyRewardsCard />
            </div>
          </SectionPageLayout.Content>
        </SectionPageLayout>

        <ProfileFormDialog />
      </>
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Agent Workbench')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]'>
            <div className='min-w-0'>
              <CustomersTable />
            </div>

            <aside
              aria-label={t('Agent summary')}
              className='flex flex-col gap-4'
            >
              <EarningsCard />
              <PromoLinkCard />
              <IdentityCard />
              <QrcodeCard />
              <LegacyRewardsCard />
            </aside>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ProfileFormDialog />
      <WithdrawalDialog />
      <WithdrawalsSheet />
      <CommissionsSheet />
    </>
  )
}

/**
 * Agent referral page.
 *
 * On the workbench the customer list holds the main area and the money and
 * identity cards run down a rail beside it. The rail is second in source order
 * so that on a phone — where the grid collapses to one column — the list the
 * agent came for stays on top and the cards follow underneath.
 */
export function Agent() {
  const { t } = useTranslation()
  const { status } = useStatus()

  // The route guard turns anyone away while the programme is off, but it only
  // runs on navigation. A tab already sitting here when an operator flips the
  // switch would keep rendering the workbench over requests that
  // requireAgentProgramme now rejects, so the page checks the same flag itself
  // and stops short of mounting the provider — no failing overview request, no
  // error toast, no empty cards. Strictly `=== false`: the guard guarantees
  // status is cached by the time this renders, so an absent flag means a payload
  // that predates the field, and locking the page for that would be wrong.
  if (status?.agent_enabled === false) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Agent Workbench')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <EmptyState
            icon={Share2}
            title={t('The referral program is turned off')}
            description={t(
              'An administrator has disabled it. Commission already earned is kept, and both accrual and withdrawal resume once the program is turned back on.'
            )}
            action={
              <Button size='sm' render={<Link to='/' />}>
                {t('Back to Home')}
              </Button>
            }
            bordered
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  return (
    <AgentProvider>
      <AgentContent />
    </AgentProvider>
  )
}
