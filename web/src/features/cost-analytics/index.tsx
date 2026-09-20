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
import { getRouteApi } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { FadeIn } from '@/components/page-transition'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'

import {
  getCostChannelModels,
  getCostChannels,
  getCostInventory,
  getCostOverview,
  getCostTrend,
} from './api'
import { ChannelMarginRanking } from './components/channel-margin-ranking'
import { CostDetailTable } from './components/cost-detail-table'
import { InventoryTable } from './components/inventory-table'
import { ModelChannelTable } from './components/model-channel-table'
import { OverviewCards } from './components/overview-cards'
import { ProfitTrendChart } from './components/profit-trend-chart'
import {
  ALL_MODELS_FILTER,
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  QUERY_KEY_COST_CHANNELS,
  QUERY_KEY_COST_CHANNEL_MODELS,
  QUERY_KEY_COST_INVENTORY,
  QUERY_KEY_COST_OVERVIEW,
  QUERY_KEY_COST_TREND,
  WINDOW_PRESETS,
} from './constants'
import { collectModelNames, formatDayLabel } from './lib'

const route = getRouteApi('/_authenticated/cost-analytics/')

type ViewTab = 'overview' | 'models' | 'inventory'

/**
 * Channel cost & margin analytics.
 *
 * Read-only: cost pricing is edited on the channel page (cost section in the
 * edit drawer) and purchases are recorded there too. This page answers the
 * ledger questions — which channel/model is losing money, is the unpriced
 * share under control, do the two balances reconcile.
 */
export function CostAnalytics() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()

  const nowSeconds = useMemo(() => Math.floor(Date.now() / 1000), [])

  const window = useMemo(() => {
    const days = search.days ?? DEFAULT_WINDOW_DAYS
    const clamped = days > MAX_WINDOW_DAYS
    return {
      days: clamped ? MAX_WINDOW_DAYS : days,
      clamped,
      startTimestamp: nowSeconds - (clamped ? MAX_WINDOW_DAYS : days) * 86_400,
      endTimestamp: nowSeconds,
    }
  }, [nowSeconds, search.days])

  const params = {
    start_timestamp: window.startTimestamp,
    end_timestamp: window.endTimestamp,
  }

  const overviewQuery = useQuery({
    queryKey: [QUERY_KEY_COST_OVERVIEW, params],
    queryFn: () => getCostOverview(params),
    staleTime: 60_000,
  })
  const trendQuery = useQuery({
    queryKey: [QUERY_KEY_COST_TREND, params],
    queryFn: () => getCostTrend(params),
    staleTime: 60_000,
  })
  const channelsQuery = useQuery({
    queryKey: [QUERY_KEY_COST_CHANNELS, params],
    queryFn: () => getCostChannels(params),
    staleTime: 60_000,
  })
  const channelModelsQuery = useQuery({
    queryKey: [QUERY_KEY_COST_CHANNEL_MODELS, params],
    queryFn: () => getCostChannelModels(params),
    staleTime: 60_000,
  })
  const inventoryQuery = useQuery({
    queryKey: [QUERY_KEY_COST_INVENTORY],
    queryFn: () => getCostInventory(),
    staleTime: 300_000,
  })

  // Model focus is component state, not URL state: the route's search schema is
  // days + tab, and a zod object drops anything else on navigate, so a search
  // param would be silently discarded on the next range switch.
  const [modelFilter, setModelFilter] = useState<string>(ALL_MODELS_FILTER)

  // Keyed off the query payload, not a fresh `?? []` literal, so the derived
  // grouping below is not rebuilt on every unrelated render.
  const channelModelRows = useMemo(
    () => channelModelsQuery.data?.data ?? [],
    [channelModelsQuery.data]
  )
  const modelNames = useMemo(
    () => collectModelNames(channelModelRows),
    [channelModelRows]
  )
  // Shrinking the window can drop the focused model entirely. Falling back to
  // "all" beats an empty table under a filter this window cannot satisfy — but
  // only once models are actually known, otherwise the selection would blink
  // back to "all" during every refetch.
  const activeModelFilter =
    modelFilter !== ALL_MODELS_FILTER &&
    modelNames.length > 0 &&
    !modelNames.includes(modelFilter)
      ? ALL_MODELS_FILTER
      : modelFilter

  const focusedRows = useMemo(
    () =>
      activeModelFilter === ALL_MODELS_FILTER
        ? channelModelRows
        : channelModelRows.filter(
            (row) => row.model_name === activeModelFilter
          ),
    [activeModelFilter, channelModelRows]
  )

  const handlePresetChange = useCallback(
    (days: number) => {
      void navigate({ search: { days } })
    },
    [navigate]
  )

  const handleTabChange = useCallback(
    (tab: string) => {
      void navigate({
        search: { days: window.days, tab: tab as ViewTab },
      })
    },
    [navigate, window.days]
  )

  const activeTab: ViewTab =
    search.tab === 'inventory' || search.tab === 'models'
      ? search.tab
      : 'overview'

  const failed =
    overviewQuery.isError ||
    overviewQuery.data?.success === false ||
    channelsQuery.isError ||
    channelsQuery.data?.success === false

  const modelsFailed =
    channelModelsQuery.isError || channelModelsQuery.data?.success === false

  const windowLabel = t('{{start}} to {{end}} · {{days}} days', {
    start: formatDayLabel(window.startTimestamp) ?? '',
    end: formatDayLabel(window.endTimestamp) ?? '',
    days: window.days,
  })

  const rangeTabs = (
    <Tabs
      value={String(window.days)}
      onValueChange={(value) => handlePresetChange(Number(value))}
      className='shrink-0'
    >
      <TabsList
        className='max-w-full flex-wrap justify-start'
        aria-label={t('Analysis window')}
      >
        {WINDOW_PRESETS.map((preset) => (
          <TabsTrigger
            key={preset.days}
            value={String(preset.days)}
            className='px-2.5 text-xs'
          >
            {t(preset.labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )

  const viewTabs = (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className='shrink-0'
    >
      <TabsList aria-label={t('Cost view')}>
        <TabsTrigger value='overview' className='px-2.5 text-xs'>
          {t('Overview')}
        </TabsTrigger>
        <TabsTrigger value='models' className='px-2.5 text-xs'>
          {t('By model')}
        </TabsTrigger>
        <TabsTrigger value='inventory' className='px-2.5 text-xs'>
          {t('Inventory')}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )

  // Shared by every windowed view, so the trimmed range is never silently
  // applied to one tab and announced on another.
  const clampedAlert = window.clamped ? (
    <Alert>
      <TriangleAlert aria-hidden='true' />
      <AlertDescription>
        {t(
          'The requested range exceeded the maximum and was trimmed to the most recent {{days}} days.',
          { days: MAX_WINDOW_DAYS }
        )}
      </AlertDescription>
    </Alert>
  ) : null

  const modelFilterSelect = (
    <Select
      value={activeModelFilter}
      onValueChange={(value) => value !== null && setModelFilter(String(value))}
    >
      <SelectTrigger className='h-8 w-44' aria-label={t('Focus on one model')}>
        <SelectValue>
          {activeModelFilter === ALL_MODELS_FILTER
            ? t('All models')
            : activeModelFilter}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectItem value={ALL_MODELS_FILTER}>{t('All models')}</SelectItem>
          {modelNames.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Cost Analytics')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex flex-wrap items-center gap-2'>
          {viewTabs}
          {activeTab !== 'inventory' && rangeTabs}
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {activeTab === 'overview' && (
          <div className='space-y-3 sm:space-y-4'>
            {clampedAlert}

            {failed && (
              <Alert variant='destructive'>
                <TriangleAlert aria-hidden='true' />
                <AlertDescription>
                  {overviewQuery.data?.message ??
                    t('Failed to load cost analytics')}
                </AlertDescription>
              </Alert>
            )}

            <FadeIn>
              <OverviewCards
                overview={overviewQuery.data?.data}
                loading={overviewQuery.isLoading}
                error={failed}
                windowLabel={windowLabel}
              />
            </FadeIn>

            <FadeIn delay={0.1}>
              <ProfitTrendChart
                trend={trendQuery.data?.data ?? []}
                loading={trendQuery.isLoading}
              />
            </FadeIn>

            <FadeIn delay={0.15}>
              <ChannelMarginRanking
                channels={channelsQuery.data?.data ?? []}
                loading={channelsQuery.isLoading}
              />
            </FadeIn>

            <FadeIn delay={0.2}>
              <PanelWrapper
                title={t('Channel detail')}
                description={t(
                  'One aggregated row per channel, worst margin first.'
                )}
                loading={channelsQuery.isLoading}
                height=''
              >
                <CostDetailTable
                  channels={channelsQuery.data?.data ?? []}
                  loading={channelsQuery.isLoading}
                />
              </PanelWrapper>
            </FadeIn>
          </div>
        )}

        {activeTab === 'models' && (
          <div className='space-y-3 sm:space-y-4'>
            {clampedAlert}

            {modelsFailed && (
              <Alert variant='destructive'>
                <TriangleAlert aria-hidden='true' />
                <AlertDescription>
                  {channelModelsQuery.data?.message ??
                    t('Failed to load cost analytics')}
                </AlertDescription>
              </Alert>
            )}

            <FadeIn>
              <PanelWrapper
                title={t('Margin by model across channels')}
                description={t(
                  'Every channel serving the same model, worst margin first — which upstream buys cheapest, and which one is losing money. {{window}}',
                  { window: windowLabel }
                )}
                loading={channelModelsQuery.isLoading}
                headerActions={modelFilterSelect}
                height=''
              >
                <ModelChannelTable
                  rows={focusedRows}
                  loading={channelModelsQuery.isLoading}
                />
              </PanelWrapper>
            </FadeIn>
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className='space-y-3 sm:space-y-4'>
            <FadeIn>
              <PanelWrapper
                title={t('Inventory reconciliation')}
                description={t(
                  'Upstream-fetched balance vs derived balance (purchases − accumulated cost). A large divergence means a cost price is misconfigured or a purchase was never recorded.'
                )}
                loading={inventoryQuery.isLoading}
                height=''
              >
                <InventoryTable
                  rows={inventoryQuery.data?.data ?? []}
                  loading={inventoryQuery.isLoading}
                />
              </PanelWrapper>
            </FadeIn>
          </div>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
