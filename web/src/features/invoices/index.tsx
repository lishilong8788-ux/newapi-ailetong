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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuthStore } from '@/stores/auth-store'

import { getSelfInvoiceDownloadUrl } from './api'
import {
  CancelInvoiceRequestDialog,
  DeleteInvoiceProfileDialog,
} from './components/dialogs/invoice-confirm-dialogs'
import { InvoiceProfileDrawer } from './components/dialogs/invoice-profile-drawer'
import { InvoiceRequestDrawer } from './components/dialogs/invoice-request-drawer'
import { InvoiceProfilesTab } from './components/invoice-profiles-tab'
import { InvoiceRequestsTab } from './components/invoice-requests-tab'
import { InvoiceSummaryHeader } from './components/invoice-summary-header'
import {
  InvoiceProfilesToolbar,
  InvoiceRequestsToolbar,
  PendingOrdersToolbar,
} from './components/invoice-toolbars'
import { PendingOrdersTab } from './components/pending-orders-tab'
import {
  INVOICE_TABS,
  INVOICE_TAB_IDS,
  INVOICE_TAB_LABEL_KEYS,
  type InvoiceTabId,
} from './constants'
import {
  useInvoiceProfiles,
  useInvoiceRequestSubmit,
  useInvoiceRequests,
  useInvoiceSummary,
  useInvoiceableOrders,
} from './hooks'
import type { InvoiceProfile, InvoiceRequest, InvoiceableOrder } from './types'

export function Invoices() {
  const { t } = useTranslation()
  const userEmail = useAuthStore((state) => state.auth.user?.email ?? '')

  const [activeTab, setActiveTab] = useState<InvoiceTabId>(INVOICE_TABS.PENDING)
  const [requestDrawerOrders, setRequestDrawerOrders] = useState<
    InvoiceableOrder[] | null
  >(null)
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<InvoiceProfile>()
  const [profilePendingDelete, setProfilePendingDelete] =
    useState<InvoiceProfile>()
  const [requestPendingCancel, setRequestPendingCancel] =
    useState<InvoiceRequest>()

  const orders = useInvoiceableOrders()
  const requests = useInvoiceRequests()
  const profiles = useInvoiceProfiles()
  const summary = useInvoiceSummary()
  const { submitting, submitRequest } = useInvoiceRequestSubmit()

  const drawerOrders = requestDrawerOrders ?? []
  const drawerCurrency =
    drawerOrders.length > 0 ? drawerOrders[0].currency : null
  const drawerTotalMinor = drawerOrders.reduce(
    (total, order) => total + Math.trunc(order.amount),
    0
  )

  const handleSubmitRequest = async (
    values: Parameters<typeof submitRequest>[0],
    selected: InvoiceableOrder[]
  ) => {
    const succeeded = await submitRequest(values, selected)
    if (!succeeded) return false

    setRequestDrawerOrders(null)
    orders.clearSelection()
    await orders.refresh()
    await requests.refresh()
    await summary.refresh()
    setActiveTab(INVOICE_TABS.REQUESTS)
    return true
  }

  const handleConfirmCancel = async () => {
    if (!requestPendingCancel) return
    const succeeded = await requests.cancelRequest(requestPendingCancel.id)
    if (succeeded) {
      setRequestPendingCancel(undefined)
      await orders.refresh()
      await summary.refresh()
    }
  }

  const handleConfirmDeleteProfile = async () => {
    if (!profilePendingDelete) return
    const succeeded = await profiles.removeProfile(profilePendingDelete.id)
    if (succeeded) {
      setProfilePendingDelete(undefined)
    }
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Invoices')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='flex w-full flex-col gap-4'>
            <InvoiceSummaryHeader
              summaries={summary.summaries}
              loading={summary.loading}
            />

            <Tabs
              className='bg-card gap-0 overflow-hidden rounded-xl border'
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as InvoiceTabId)}
            >
              <div className='flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4'>
                <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto sm:group-data-horizontal/tabs:h-9'>
                  {INVOICE_TAB_IDS.map((tab) => (
                    <TabsTrigger key={tab} value={tab} className='px-3'>
                      {t(INVOICE_TAB_LABEL_KEYS[tab])}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {activeTab === INVOICE_TABS.PENDING && (
                  <PendingOrdersToolbar
                    loading={orders.loading}
                    selectedCount={orders.selectedOrders.length}
                    selectedTotalMinor={orders.selectedTotalMinor}
                    selectionCurrency={orders.selectionCurrency.currency}
                    mixedCurrency={orders.selectionCurrency.mixed}
                    onRefresh={() => {
                      void orders.refresh()
                      void summary.refresh()
                    }}
                    onRequestSelected={() =>
                      setRequestDrawerOrders(orders.selectedOrders)
                    }
                  />
                )}

                {activeTab === INVOICE_TABS.REQUESTS && (
                  <InvoiceRequestsToolbar
                    keyword={requests.keyword}
                    status={requests.status}
                    loading={requests.loading}
                    onKeywordChange={requests.changeKeyword}
                    onStatusChange={requests.changeStatus}
                    onRefresh={() => {
                      void requests.refresh()
                      void summary.refresh()
                    }}
                  />
                )}

                {activeTab === INVOICE_TABS.PROFILES && (
                  <InvoiceProfilesToolbar
                    loading={profiles.loading}
                    onRefresh={() => void profiles.refresh()}
                    onCreate={() => {
                      setEditingProfile(undefined)
                      setProfileDrawerOpen(true)
                    }}
                  />
                )}
              </div>

              <TabsContent value={INVOICE_TABS.PENDING}>
                <PendingOrdersTab
                  orders={orders.orders}
                  loading={orders.loading}
                  selectedKeys={orders.selectedKeys}
                  selectedCount={orders.selectedOrders.length}
                  mixedCurrency={orders.selectionCurrency.mixed}
                  onToggleOrder={orders.toggleOrder}
                  onToggleAll={orders.toggleAll}
                  onRequestSingle={(order) => setRequestDrawerOrders([order])}
                />
              </TabsContent>

              <TabsContent value={INVOICE_TABS.REQUESTS}>
                <InvoiceRequestsTab
                  requests={requests.requests}
                  total={requests.total}
                  page={requests.page}
                  pageSize={requests.pageSize}
                  loading={requests.loading}
                  cancelling={requests.cancelling}
                  onPageChange={requests.setPage}
                  onDownload={(request) =>
                    window.open(
                      getSelfInvoiceDownloadUrl(request.id),
                      '_blank',
                      'noopener,noreferrer'
                    )
                  }
                  onCancel={setRequestPendingCancel}
                />
              </TabsContent>

              <TabsContent value={INVOICE_TABS.PROFILES}>
                <InvoiceProfilesTab
                  profiles={profiles.profiles}
                  loading={profiles.loading}
                  busy={profiles.saving}
                  onCreate={() => {
                    setEditingProfile(undefined)
                    setProfileDrawerOpen(true)
                  }}
                  onEdit={(profile) => {
                    setEditingProfile(profile)
                    setProfileDrawerOpen(true)
                  }}
                  onDelete={setProfilePendingDelete}
                  onSetDefault={(profile) =>
                    void profiles.markProfileDefault(profile)
                  }
                />
              </TabsContent>
            </Tabs>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <InvoiceRequestDrawer
        open={requestDrawerOrders !== null}
        onOpenChange={(open) => !open && setRequestDrawerOrders(null)}
        orders={drawerOrders}
        totalMinor={drawerTotalMinor}
        currency={drawerCurrency}
        profiles={profiles.profiles}
        defaultEmail={userEmail}
        submitting={submitting}
        onManageProfiles={() => {
          setRequestDrawerOrders(null)
          setActiveTab(INVOICE_TABS.PROFILES)
        }}
        onSubmit={handleSubmitRequest}
      />

      <InvoiceProfileDrawer
        open={profileDrawerOpen}
        onOpenChange={setProfileDrawerOpen}
        currentProfile={editingProfile}
        saving={profiles.saving}
        onSubmit={profiles.saveProfile}
      />

      <CancelInvoiceRequestDialog
        open={requestPendingCancel !== undefined}
        onOpenChange={(open) => !open && setRequestPendingCancel(undefined)}
        cancelling={requests.cancelling}
        onConfirm={() => void handleConfirmCancel()}
      />

      <DeleteInvoiceProfileDialog
        open={profilePendingDelete !== undefined}
        onOpenChange={(open) => !open && setProfilePendingDelete(undefined)}
        profileTitle={profilePendingDelete?.title ?? ''}
        deleting={profiles.saving}
        onConfirm={() => void handleConfirmDeleteProfile()}
      />
    </>
  )
}
