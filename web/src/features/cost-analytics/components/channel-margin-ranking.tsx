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
  buildMarginRanking,
  chartAxisTokens,
  datumNumber,
  datumString,
  formatRate,
} from '../lib'
import type { CostChannelRow } from '../types'
import { ChartFrame } from './chart-frame'
import { RANKING_LIMIT } from '../constants'

interface ChannelMarginRankingProps {
  channels: CostChannelRow[]
  loading: boolean
}

/**
 * Channels by margin rate, worst first — the page's action list.
 *
 * Horizontal because channel names are free text. Worst-first because the
 * reader's next move is usually "what do I do about the loser at the top",
 * not "congratulate the winner".
 */
export function ChannelMarginRanking(props: ChannelMarginRankingProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const axis = chartAxisTokens(resolvedTheme)

  const entries = useMemo(
    () => buildMarginRanking(props.channels, RANKING_LIMIT, true),
    [props.channels]
  )

  const spec = useMemo(() => {
    if (entries.length === 0) return null

    return {
      type: 'bar' as const,
      data: [
        {
          id: 'channelMargin',
          // Ascending: a horizontal band axis draws its first category at the
          // bottom, so the worst margin has to be last to land at the top.
          values: [...entries]
            .reverse()
            .map((entry) => ({
              channel: entry.label,
              value: entry.value,
            })),
        },
      ],
      xField: 'value',
      yField: 'channel',
      direction: 'horizontal' as const,
      legends: { visible: false },
      bar: { state: { hover: { fillOpacity: 0.8 } } },
      label: {
        visible: true,
        position: 'outside' as const,
        formatMethod: (value: string | number) => formatRate(Number(value)),
        style: { fontSize: 10, fill: axis.textColor },
      },
      axes: [
        {
          orient: 'left' as const,
          type: 'band' as const,
          label: { style: { fill: axis.textColor, fontSize: 10 } },
          tick: { visible: false },
          title: { visible: true, text: t('Channel'), style: axis.titleStyle },
        },
        {
          orient: 'bottom' as const,
          type: 'linear' as const,
          label: {
            formatMethod: (value: string | number) =>
              formatRate(Number(value), 0),
            style: { fill: axis.textColor, fontSize: 10 },
          },
          grid: {
            visible: true,
            style: { lineDash: [3, 3], stroke: axis.gridColor },
          },
          title: {
            visible: true,
            text: t('Margin rate'),
            style: axis.titleStyle,
          },
        },
      ],
      tooltip: {
        mark: {
          title: {
            value: (datum: unknown) => datumString(datum, 'channel'),
          },
          content: [
            {
              key: t('Margin rate'),
              value: (datum: unknown) =>
                formatRate(datumNumber(datum, 'value')),
            },
          ],
        },
      },
      background: { fill: 'transparent' },
    }
  }, [axis.gridColor, axis.textColor, axis.titleStyle, entries, t])

  return (
    <PanelWrapper
      title={t('Channel margin ranking')}
      description={t(
        'Bottom {{limit}} channels by margin rate. The losers surface first — they are the action items.',
        { limit: RANKING_LIMIT }
      )}
      loading={props.loading}
      empty={!props.loading && entries.length === 0}
      emptyMessage={t('No channel has a resolvable margin yet')}
      height='h-[320px]'
      contentClassName='p-2 sm:p-3'
    >
      <ChartFrame
        label={t('Channel margin ranking')}
        description={t(
          'Horizontal bar chart of channels by margin rate, worst first. Every channel is also listed in the detail table below.'
        )}
      >
        {themeReady && spec && (
          <LazyVChart
            key={`channel-margin-${resolvedTheme}`}
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
