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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { LazyVChart } from '@/components/lazy-vchart'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import { GRANULARITY_OPTIONS } from '../constants'
import {
  bucketTrend,
  chartAxisTokens,
  datumNumber,
  datumString,
  formatCount,
  formatRmb,
  formatRmbCompact,
} from '../lib'
import type {
  AgentAnalyticsGranularity,
  AgentAnalyticsTrendPoint,
} from '../types'
import { ChartFrame } from './chart-frame'

interface PromotionTrendChartProps {
  trend: AgentAnalyticsTrendPoint[]
  granularity: AgentAnalyticsGranularity
  onGranularityChange: (granularity: AgentAnalyticsGranularity) => void
  loading: boolean
}

const SERIES_CUSTOMERS = 'customers'
const SERIES_REVENUE = 'revenue'

/**
 * New customers against promoted revenue over time.
 *
 * The two live on separate axes on purpose: a headcount in the tens and a
 * revenue figure in the thousands share no scale, and forcing them onto one axis
 * flattens the customer line into the baseline.
 */
export function PromotionTrendChart(props: PromotionTrendChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const axis = chartAxisTokens(resolvedTheme)

  const buckets = useMemo(
    () => bucketTrend(props.trend, props.granularity),
    [props.trend, props.granularity]
  )

  const spec = useMemo(() => {
    if (buckets.length === 0) return null

    const values = buckets.map((bucket) => ({
      bucket: bucket.key,
      customers: bucket.new_customers,
      revenue: bucket.revenue,
    }))

    return {
      type: 'common' as const,
      seriesField: 'type',
      data: [{ id: 'promotionTrend', values }],
      series: [
        {
          type: 'line' as const,
          id: SERIES_CUSTOMERS,
          name: t('New customers'),
          dataIndex: 0,
          xField: 'bucket',
          yField: 'customers',
          smooth: true,
          point: { visible: true, style: { size: 5 } },
          line: { style: { lineWidth: 2 } },
          tooltip: {
            mark: {
              title: {
                value: (datum: unknown) => datumString(datum, 'bucket'),
              },
              content: [
                {
                  key: t('New customers'),
                  value: (datum: unknown) =>
                    formatCount(datumNumber(datum, 'customers')),
                },
              ],
            },
          },
        },
        {
          type: 'line' as const,
          id: SERIES_REVENUE,
          name: t('Promoted revenue'),
          dataIndex: 0,
          xField: 'bucket',
          yField: 'revenue',
          smooth: true,
          point: { visible: true, style: { size: 5 } },
          line: { style: { lineWidth: 2 } },
          tooltip: {
            mark: {
              title: {
                value: (datum: unknown) => datumString(datum, 'bucket'),
              },
              content: [
                {
                  key: t('Promoted revenue'),
                  value: (datum: unknown) =>
                    formatRmb(datumNumber(datum, 'revenue')),
                },
              ],
            },
          },
        },
      ],
      axes: [
        {
          orient: 'bottom' as const,
          type: 'band' as const,
          label: {
            style: { fill: axis.textColor, fontSize: 10 },
            autoHide: true,
            autoLimit: true,
          },
          tick: { visible: false },
          title: { visible: true, text: t('Date'), style: axis.titleStyle },
        },
        {
          orient: 'left' as const,
          type: 'linear' as const,
          seriesId: [SERIES_CUSTOMERS],
          min: 0,
          label: {
            formatMethod: (value: string | number) =>
              formatCount(Number(value)),
            style: { fill: axis.textColor, fontSize: 10 },
          },
          grid: {
            visible: true,
            style: { lineDash: [3, 3], stroke: axis.gridColor },
          },
          title: {
            visible: true,
            text: t('New customers'),
            style: axis.titleStyle,
          },
        },
        {
          orient: 'right' as const,
          type: 'linear' as const,
          seriesId: [SERIES_REVENUE],
          min: 0,
          label: {
            formatMethod: (value: string | number) =>
              formatRmbCompact(Number(value)),
            style: { fill: axis.textColor, fontSize: 10 },
          },
          grid: { visible: false },
          title: {
            visible: true,
            text: t('Promoted revenue (RMB)'),
            style: axis.titleStyle,
          },
        },
      ],
      legends: {
        visible: true,
        orient: 'top' as const,
        position: 'start' as const,
      },
      background: { fill: 'transparent' },
    }
  }, [axis.gridColor, axis.textColor, axis.titleStyle, buckets, t])

  const granularityTabs = (
    <Tabs
      value={props.granularity}
      onValueChange={(value) =>
        props.onGranularityChange(value as AgentAnalyticsGranularity)
      }
      className='shrink-0'
    >
      <TabsList aria-label={t('Trend bucket width')}>
        {GRANULARITY_OPTIONS.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            className='px-2.5 text-xs'
          >
            {t(option.labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )

  return (
    <PanelWrapper
      title={t('Promotion trend')}
      description={t(
        'New customers and promoted revenue over time, on separate axes.'
      )}
      loading={props.loading}
      empty={!props.loading && buckets.length === 0}
      emptyMessage={t('No promotion activity in this window')}
      height='h-[320px]'
      headerActions={granularityTabs}
      contentClassName='p-2 sm:p-3'
    >
      <ChartFrame
        label={t('Promotion trend')}
        description={t(
          'Line chart of new customers against promoted revenue per bucket. The same figures are listed per agent in the detail table below.'
        )}
      >
        {themeReady && spec && (
          <LazyVChart
            key={`promotion-trend-${props.granularity}-${resolvedTheme}`}
            spec={{
              ...spec,
              theme: resolvedTheme === 'dark' ? 'dark' : 'light',
            }}
            option={VCHART_OPTION}
          />
        )}
      </ChartFrame>
    </PanelWrapper>
  )
}
