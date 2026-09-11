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
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import {
  bucketTrend,
  chartAxisTokens,
  datumNumber,
  datumString,
  formatRate,
  formatRmb,
  formatRmbCompact,
} from '../lib'
import type { AgentAnalyticsTrendPoint } from '../types'
import { ChartFrame } from './chart-frame'

interface CommissionTrendChartProps {
  trend: AgentAnalyticsTrendPoint[]
  loading: boolean
}

const SERIES_REVENUE = 'revenue'
const SERIES_COMMISSION = 'commission'
const SERIES_RATE = 'rate'

/**
 * Commission spend against promoted revenue by month, with the effective rate
 * overlaid.
 *
 * Fixed to months regardless of the page's granularity toggle: this chart exists
 * to show a slow drift in blended cost, and daily buckets make the rate line
 * jump on single large commissions instead of showing the trend.
 */
export function CommissionTrendChart(props: CommissionTrendChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const axis = chartAxisTokens(resolvedTheme)

  const buckets = useMemo(
    () => bucketTrend(props.trend, 'month'),
    [props.trend]
  )

  const spec = useMemo(() => {
    if (buckets.length === 0) return null

    const values = buckets.map((bucket) => ({
      month: bucket.key,
      revenue: bucket.revenue,
      commission: bucket.commission,
      rate: bucket.effective_rate,
    }))

    const areaSeries = (
      id: string,
      name: string,
      field: 'revenue' | 'commission'
    ) => ({
      type: 'area' as const,
      id,
      name,
      dataIndex: 0,
      xField: 'month',
      yField: field,
      stack: false,
      area: { style: { fillOpacity: 0.16, curveType: 'monotone' } },
      line: { style: { lineWidth: 2, curveType: 'monotone' } },
      point: { visible: false },
      tooltip: {
        mark: {
          title: { value: (datum: unknown) => datumString(datum, 'month') },
          content: [
            {
              key: name,
              value: (datum: unknown) => formatRmb(datumNumber(datum, field)),
            },
          ],
        },
      },
    })

    return {
      type: 'common' as const,
      data: [{ id: 'commissionTrend', values }],
      series: [
        areaSeries(SERIES_REVENUE, t('Promoted revenue'), 'revenue'),
        areaSeries(SERIES_COMMISSION, t('Commission paid'), 'commission'),
        {
          type: 'line' as const,
          id: SERIES_RATE,
          name: t('Effective commission rate'),
          dataIndex: 0,
          xField: 'month',
          yField: 'rate',
          line: { style: { lineWidth: 2, lineDash: [4, 3] } },
          point: { visible: true, style: { size: 5 } },
          tooltip: {
            mark: {
              title: { value: (datum: unknown) => datumString(datum, 'month') },
              content: [
                {
                  key: t('Effective commission rate'),
                  value: (datum: unknown) =>
                    formatRate(datumNumber(datum, 'rate')),
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
          title: { visible: true, text: t('Month'), style: axis.titleStyle },
        },
        {
          orient: 'left' as const,
          type: 'linear' as const,
          seriesId: [SERIES_REVENUE, SERIES_COMMISSION],
          min: 0,
          label: {
            formatMethod: (value: string | number) =>
              formatRmbCompact(Number(value)),
            style: { fill: axis.textColor, fontSize: 10 },
          },
          grid: {
            visible: true,
            style: { lineDash: [3, 3], stroke: axis.gridColor },
          },
          title: {
            visible: true,
            text: t('Amount (RMB)'),
            style: axis.titleStyle,
          },
        },
        {
          orient: 'right' as const,
          type: 'linear' as const,
          seriesId: [SERIES_RATE],
          min: 0,
          label: {
            formatMethod: (value: string | number) =>
              formatRate(Number(value), 0),
            style: { fill: axis.textColor, fontSize: 10 },
          },
          grid: { visible: false },
          title: {
            visible: true,
            text: t('Effective commission rate'),
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

  return (
    <PanelWrapper
      title={t('Commission spend trend')}
      description={t(
        'Monthly commission against promoted revenue, with the effective rate overlaid. A rising rate means high-rate agents are taking a larger share.'
      )}
      loading={props.loading}
      empty={!props.loading && buckets.length === 0}
      emptyMessage={t('No commission recorded in this window')}
      height='h-[320px]'
      contentClassName='p-2 sm:p-3'
    >
      <ChartFrame
        label={t('Commission spend trend')}
        description={t(
          'Area chart of monthly commission and promoted revenue with the effective commission rate as a line on the right axis. The same figures are listed per agent in the detail table below.'
        )}
      >
        {themeReady && spec && (
          <LazyVChart
            key={`commission-trend-${resolvedTheme}`}
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
