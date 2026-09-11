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
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { FadeIn } from '@/components/page-transition'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { getAgentAnalytics } from './api'
import { AgentRankingChart } from './components/agent-ranking-chart'
import { AgentsDetailTable } from './components/agents-detail-table'
import { CommissionTrendChart } from './components/commission-trend-chart'
import { CustomerQualityScatter } from './components/customer-quality-scatter'
import { OverviewCards } from './components/overview-cards'
import { PromotionTrendChart } from './components/promotion-trend-chart'
import {
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  QUERY_KEY_ANALYTICS,
  WINDOW_PRESETS,
} from './constants'
import { formatCommissionDate, resolveWindow, windowDays } from './lib'
import type { AgentAnalyticsGranularity } from './types'

const route = getRouteApi('/_authenticated/agent-analytics/')

/**
 * Distribution effect analysis (design doc 11).
 *
 * Read-only by design: the agent workbench and the admin management page handle
 * money movement and answer "is this agent's balance correct". This page answers
 * a different question — which agents deserve more investment and which are
 * idling — and mixing the two makes both harder to use.
 */
export function AgentAnalytics() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()

  // One "now" per render: dormancy, the window and the labels all have to agree,
  // and a fresh Date.now() per component would let them drift mid-render.
  const nowSeconds = useMemo(() => Math.floor(Date.now() / 1000), [])

  const window = useMemo(
    () =>
      resolveWindow(
        {
          start_time: search.startTime,
          end_time: search.endTime,
          granularity: search.granularity,
        },
        nowSeconds
      ),
    [nowSeconds, search.endTime, search.granularity, search.startTime]
  )

  const analyticsQuery = useQuery({
    queryKey: [
      QUERY_KEY_ANALYTICS,
      window.start_time,
      window.end_time,
      window.granularity,
    ],
    queryFn: () =>
      getAgentAnalytics({
        start_time: window.start_time,
        end_time: window.end_time,
        granularity: window.granularity,
      }),
    staleTime: 60_000,
  })

  const handlePresetChange = useCallback(
    (days: number) => {
      void navigate({
        search: {
          startTime: nowSeconds - days * 86_400,
          endTime: nowSeconds,
          granularity: window.granularity,
        },
      })
    },
    [navigate, nowSeconds, window.granularity]
  )

  const handleGranularityChange = useCallback(
    (granularity: AgentAnalyticsGranularity) => {
      void navigate({
        search: {
          startTime: window.start_time,
          endTime: window.end_time,
          granularity,
        },
      })
    },
    [navigate, window.end_time, window.start_time]
  )

  const activeDays = windowDays(window)
  const activePreset =
    WINDOW_PRESETS.find((preset) => preset.days === activeDays)?.days ??
    DEFAULT_WINDOW_DAYS

  // Spelled out rather than shown as a day count alone: every number on this page
  // covers only this window, and a viewer who reads a partial total as all-time
  // draws the wrong conclusion about the channel.
  const windowLabel = t('{{start}} to {{end}} · {{days}} days', {
    start: formatCommissionDate(window.start_time) ?? '',
    end: formatCommissionDate(window.end_time) ?? '',
    days: activeDays,
  })

  const data = analyticsQuery.data?.data
  const loading = analyticsQuery.isLoading
  const failed =
    analyticsQuery.isError || analyticsQuery.data?.success === false

  const rangeTabs = (
    <Tabs
      value={String(activePreset)}
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

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Distribution Analytics')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>{rangeTabs}</SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-3 sm:space-y-4'>
          {window.clamped && (
            <Alert>
              <TriangleAlert aria-hidden='true' />
              <AlertDescription>
                {t(
                  'The requested range exceeded the {{months}}-month maximum and was trimmed to the most recent {{days}} days.',
                  { months: 12, days: MAX_WINDOW_DAYS }
                )}
              </AlertDescription>
            </Alert>
          )}

          {failed && (
            <Alert variant='destructive'>
              <TriangleAlert aria-hidden='true' />
              <AlertDescription>
                {analyticsQuery.data?.message ??
                  t('Failed to load distribution analytics')}
              </AlertDescription>
            </Alert>
          )}

          <FadeIn>
            <OverviewCards
              overview={data?.overview}
              loading={loading}
              error={failed}
              windowLabel={windowLabel}
            />
          </FadeIn>

          <FadeIn delay={0.05}>
            <CustomerQualityScatter
              agents={data?.agents ?? []}
              loading={loading}
            />
          </FadeIn>

          <div className='grid gap-3 sm:gap-4 xl:grid-cols-2'>
            <FadeIn delay={0.1}>
              <PromotionTrendChart
                trend={data?.trend ?? []}
                granularity={window.granularity}
                onGranularityChange={handleGranularityChange}
                loading={loading}
              />
            </FadeIn>
            <FadeIn delay={0.15}>
              <AgentRankingChart
                agents={data?.agents ?? []}
                loading={loading}
              />
            </FadeIn>
          </div>

          <FadeIn delay={0.2}>
            <CommissionTrendChart trend={data?.trend ?? []} loading={loading} />
          </FadeIn>

          <FadeIn delay={0.25}>
            <AgentsDetailTable
              agents={data?.agents ?? []}
              loading={loading}
              nowSeconds={nowSeconds}
              windowLabel={windowLabel}
            />
          </FadeIn>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
