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
  buildScatterModel,
  chartAxisTokens,
  datumNumber,
  datumString,
  formatCount,
  formatRate,
  formatRmb,
  formatRmbCompact,
} from '../lib'
import type { AgentAnalyticsRow, AgentQualityQuadrant } from '../types'
import { ChartFrame } from './chart-frame'

interface CustomerQualityScatterProps {
  agents: AgentAnalyticsRow[]
  loading: boolean
}

const QUADRANT_LABEL_KEYS: Record<AgentQualityQuadrant, string> = {
  high_volume_high_quality: 'High volume, high quality',
  high_volume_low_quality: 'High volume, low quality',
  low_volume_high_quality: 'Low volume, high quality',
  low_volume_low_quality: 'Low volume, low quality',
}

/**
 * Fixed colours per quadrant rather than a categorical palette.
 *
 * The quadrant is the message, so the colour has to carry meaning: the two
 * quadrants that call for action (headcount farming, invest more) read as warning
 * and success, and a per-agent palette would make the same reading impossible.
 */
const QUADRANT_COLORS: Record<AgentQualityQuadrant, string> = {
  high_volume_high_quality: '#2563eb',
  high_volume_low_quality: '#f97316',
  low_volume_high_quality: '#10b981',
  low_volume_low_quality: '#94a3b8',
}

/**
 * Customer count against average revenue per customer, one point per agent.
 *
 * Design doc 11.3 makes this the core of the page: it separates "brought many
 * customers who never spend" (bottom right) from "brought few customers who spend
 * heavily" (top left) at a glance — a comparison a table of the same numbers
 * cannot convey. The quadrant guides are the cohort medians, so the split is
 * relative to the platform's own mix rather than an arbitrary threshold.
 */
export function CustomerQualityScatter(props: CustomerQualityScatterProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const axis = chartAxisTokens(resolvedTheme)

  const model = useMemo(() => buildScatterModel(props.agents), [props.agents])

  const spec = useMemo(() => {
    if (model.points.length === 0) return null

    const values = model.points.map((point) => ({
      agent: point.label,
      customers: point.customers,
      avgRevenue: point.avg_revenue,
      revenue: point.revenue,
      payingRate: point.paying_rate,
      quadrant: t(QUADRANT_LABEL_KEYS[point.quadrant]),
      quadrantKey: point.quadrant,
    }))

    const guideStyle = {
      lineWidth: 1,
      lineDash: [4, 4],
      stroke: axis.textColor,
    }
    const guideLabelStyle = {
      fontSize: 10,
      fill: axis.textColor,
    }

    return {
      type: 'scatter' as const,
      data: [{ id: 'customerQuality', values }],
      xField: 'customers',
      yField: 'avgRevenue',
      seriesField: 'quadrant',
      size: 10,
      point: {
        style: {
          fillOpacity: 0.75,
          stroke: resolvedTheme === 'dark' ? '#0f172a' : '#ffffff',
          lineWidth: 1,
        },
      },
      color: {
        type: 'ordinal' as const,
        domain: (Object.keys(QUADRANT_COLORS) as AgentQualityQuadrant[]).map(
          (key) => t(QUADRANT_LABEL_KEYS[key])
        ),
        range: (Object.keys(QUADRANT_COLORS) as AgentQualityQuadrant[]).map(
          (key) => QUADRANT_COLORS[key]
        ),
      },
      axes: [
        {
          orient: 'bottom' as const,
          type: 'linear' as const,
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
            text: t('Customers'),
            style: axis.titleStyle,
          },
        },
        {
          orient: 'left' as const,
          type: 'linear' as const,
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
            text: t('Average revenue per customer (RMB)'),
            style: axis.titleStyle,
          },
        },
      ],
      // Quadrant guides at the cohort medians: the split that makes the four
      // readings legible instead of leaving the viewer to eyeball a centre.
      markLine: [
        {
          x: model.customers_median,
          line: { style: guideStyle },
          label: {
            visible: true,
            position: 'insideEndTop' as const,
            text: t('Median customers: {{value}}', {
              value: formatCount(model.customers_median),
            }),
            labelBackground: { visible: false },
            style: guideLabelStyle,
          },
        },
        {
          y: model.avg_revenue_median,
          line: { style: guideStyle },
          label: {
            visible: true,
            position: 'insideStartTop' as const,
            text: t('Median revenue per customer: {{value}}', {
              value: formatRmbCompact(model.avg_revenue_median),
            }),
            labelBackground: { visible: false },
            style: guideLabelStyle,
          },
        },
      ],
      legends: {
        visible: true,
        orient: 'top' as const,
        position: 'start' as const,
      },
      tooltip: {
        mark: {
          title: { value: (datum: unknown) => datumString(datum, 'agent') },
          content: [
            {
              key: t('Customers'),
              value: (datum: unknown) =>
                formatCount(datumNumber(datum, 'customers')),
            },
            {
              key: t('Average revenue per customer'),
              value: (datum: unknown) =>
                formatRmb(datumNumber(datum, 'avgRevenue')),
            },
            {
              key: t('Promoted revenue'),
              value: (datum: unknown) =>
                formatRmb(datumNumber(datum, 'revenue')),
            },
            {
              key: t('Paying rate'),
              value: (datum: unknown) =>
                formatRate(datumNumber(datum, 'payingRate')),
            },
            {
              key: t('Reading'),
              value: (datum: unknown) => datumString(datum, 'quadrant'),
            },
          ],
        },
      },
      background: { fill: 'transparent' },
    }
  }, [axis.gridColor, axis.textColor, axis.titleStyle, model, resolvedTheme, t])

  return (
    <PanelWrapper
      title={t('Customer quality distribution')}
      description={t(
        'One point per agent. Top left brings few customers who spend heavily; bottom right brings many who barely spend. Guides mark the cohort medians.'
      )}
      loading={props.loading}
      empty={!props.loading && model.points.length === 0}
      emptyMessage={t('No agent has promoted a customer yet')}
      height='h-[380px]'
      contentClassName='p-2 sm:p-3'
    >
      <div className='space-y-2'>
        <ChartFrame
          label={t('Customer quality distribution')}
          description={t(
            'Scatter plot of customer count against average revenue per customer, one point per agent, split into quadrants at the cohort medians. Every plotted figure is listed per agent in the detail table below.'
          )}
        >
          {themeReady && spec && (
            <LazyVChart
              key={`customer-quality-${resolvedTheme}`}
              spec={{
                ...spec,
                theme: resolvedTheme === 'dark' ? 'dark' : 'light',
              }}
              option={VCHART_OPTION}
            />
          )}
        </ChartFrame>

        <p className='text-muted-foreground text-xs'>
          {t(
            'Agents with no promoted customers are omitted: their average revenue is undefined and plotting them at the origin would pull both medians down.'
          )}
        </p>
      </div>
    </PanelWrapper>
  )
}
