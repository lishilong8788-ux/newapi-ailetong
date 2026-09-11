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
  buildTrendChartData,
  chartAxisTokens,
  datumNumber,
  datumString,
  formatQuotaAmount,
  formatRate,
} from '../lib'
import type { CostTrendPoint } from '../types'
import { ChartFrame } from './chart-frame'

interface ProfitTrendChartProps {
  trend: CostTrendPoint[]
  loading: boolean
}

const SERIES_REVENUE = 'revenue'
const SERIES_COST = 'cost'
const SERIES_RATE = 'rate'

/**
 * Daily revenue against upstream cost with the margin rate overlaid.
 *
 * The margin rate line is the chart's reason to exist: a widening gap between
 * the two areas reads as "healthy" even when both are growing, while the rate
 * line shows the actual drift after an upstream price change.
 */
export function ProfitTrendChart(props: ProfitTrendChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const axis = chartAxisTokens(resolvedTheme)

  const data = useMemo(
    () => buildTrendChartData(props.trend),
    [props.trend]
  )

  const spec = useMemo(() => {
    if (data.length === 0) return null

    const areaSeries = (
      id: string,
      name: string,
      field: 'revenue' | 'cost'
    ) => ({
      type: 'area' as const,
      id,
      name,
      dataIndex: 0,
      xField: 'day',
      yField: field,
      stack: false,
      area: { style: { fillOpacity: 0.16, curveType: 'monotone' } },
      line: { style: { lineWidth: 2, curveType: 'monotone' } },
      point: { visible: false },
      tooltip: {
        mark: {
          title: { value: (datum: unknown) => datumString(datum, 'day') },
          content: [
            {
              key: name,
              value: (datum: unknown) =>
                formatQuotaAmount(datumNumber(datum, field)),
            },
          ],
        },
      },
    })

    return {
      type: 'common' as const,
      data: [{ id: 'costTrend', values: data }],
      series: [
        areaSeries(SERIES_REVENUE, t('Revenue'), 'revenue'),
        areaSeries(SERIES_COST, t('Upstream cost'), 'cost'),
        {
          type: 'line' as const,
          id: SERIES_RATE,
          name: t('Margin rate'),
          dataIndex: 0,
          xField: 'day',
          yField: 'rate',
          line: { style: { lineWidth: 2, lineDash: [4, 3] } },
          point: {
            visible: true,
            style: { size: 5 },
          },
          tooltip: {
            mark: {
              title: { value: (datum: unknown) => datumString(datum, 'day') },
              content: [
                {
                  key: t('Margin rate'),
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
          title: { visible: true, text: t('Day'), style: axis.titleStyle },
        },
        {
          orient: 'left' as const,
          type: 'linear' as const,
          seriesId: [SERIES_REVENUE, SERIES_COST],
          min: 0,
          label: {
            formatMethod: (value: string | number) =>
              formatQuotaAmount(Number(value)),
            style: { fill: axis.textColor, fontSize: 10 },
          },
          grid: {
            visible: true,
            style: { lineDash: [3, 3], stroke: axis.gridColor },
          },
          title: { visible: true, text: t('Amount'), style: axis.titleStyle },
        },
        {
          orient: 'right' as const,
          type: 'linear' as const,
          seriesId: [SERIES_RATE],
          label: {
            formatMethod: (value: string | number) =>
              formatRate(Number(value), 0),
            style: { fill: axis.textColor, fontSize: 10 },
          },
          grid: { visible: false },
          title: {
            visible: true,
            text: t('Margin rate'),
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
  }, [axis.gridColor, axis.textColor, axis.titleStyle, data, t])

  return (
    <PanelWrapper
      title={t('Margin trend')}
      description={t(
        'Daily revenue against upstream cost, with the margin rate overlaid. A falling rate after an upstream price change shows up here first.'
      )}
      loading={props.loading}
      empty={!props.loading && data.length === 0}
      emptyMessage={t('No traffic recorded in this window')}
      height='h-[320px]'
      contentClassName='p-2 sm:p-3'
    >
      <ChartFrame
        label={t('Margin trend')}
        description={t(
          'Area chart of daily revenue and upstream cost with the margin rate as a line on the right axis. The same figures are listed per channel in the detail table below.'
        )}
      >
        {themeReady && spec && (
          <LazyVChart
            key={`cost-trend-${resolvedTheme}`}
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
