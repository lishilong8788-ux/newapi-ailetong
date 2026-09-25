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
import { Calendar as CalendarIcon, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import type { DateRange } from 'react-day-picker'
import { enUS, fr, ja, ru, vi, zhCN } from 'react-day-picker/locale'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import dayjs from '@/lib/dayjs'

import { LedgerTable } from './components/ledger-table'
import { MAX_WINDOW_DAYS, SECONDS_PER_DAY, WINDOW_PRESETS } from './constants'
import { resolveLedgerWindow } from './lib'

const route = getRouteApi('/_authenticated/transaction-ledger/')

// react-day-picker ships its own locale objects, unrelated to the i18next
// catalogue, so they have to be mapped by hand. Same table as the cost analytics
// page — zh-TW has no bundle and falls back to zhCN rather than English months.
const calendarLocales = {
  en: enUS,
  zh: zhCN,
  'zh-TW': zhCN,
  fr,
  ru,
  ja,
  vi,
} as const

/**
 * Per-request transaction ledger.
 *
 * Answers the questions the aggregate cost page cannot: for this one request,
 * which channel served it, which vendor is behind that channel, what the
 * customer paid, what we paid upstream, and what was left. The daily rollup on
 * the cost analytics page is the right tool for range-wide totals; this one is
 * the row-level audit trail behind them.
 *
 * Read-only. Cost prices and profit rates are edited on the channel drawer.
 */
export function TransactionLedger() {
  const { t, i18n } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const calendarLocale =
    calendarLocales[i18n.language as keyof typeof calendarLocales] ?? enUS

  const nowSeconds = useMemo(() => Math.floor(Date.now() / 1000), [])

  const window = useMemo(
    () => resolveLedgerWindow(search, nowSeconds),
    [nowSeconds, search]
  )

  // Both handlers merge into the previous search rather than replacing it: a
  // whole-object search drops every key it omits, which would clear the reader's
  // filters on a range switch.
  const handlePresetChange = useCallback(
    (value: string) => {
      const days = Number(value)
      if (!Number.isFinite(days)) return
      // Clearing the explicit range is what lets the preset take effect again;
      // leaving it set would make the tab look active but change nothing.
      void navigate({
        search: (prev) => ({
          ...prev,
          days,
          start: undefined,
          end: undefined,
          page: 1,
        }),
      })
    },
    [navigate]
  )

  // A single click leaves `to` undefined; treat it as that one day so the first
  // click already produces a valid window instead of nothing.
  const handleRangeSelect = useCallback(
    (range: DateRange | undefined) => {
      if (!range?.from) {
        void navigate({
          search: (prev) => ({
            ...prev,
            start: undefined,
            end: undefined,
            page: 1,
          }),
        })
        return
      }
      void navigate({
        search: (prev) => ({
          ...prev,
          start: dayjs(range.from).startOf('day').unix(),
          end: dayjs(range.to ?? range.from)
            .endOf('day')
            .unix(),
          page: 1,
        }),
      })
    },
    [navigate]
  )

  const windowLabel = t('{{start}} to {{end}} · {{days}} days', {
    start: dayjs.unix(window.startTimestamp).format('YYYY-MM-DD'),
    end: dayjs.unix(window.endTimestamp).format('YYYY-MM-DD'),
    days: window.days,
  })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Transaction Ledger')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex flex-wrap items-center gap-2'>
          {/* Empty value while a custom range is active: the presets are a
              shortcut for "the last N days", and a hand-picked window is none
              of them. */}
          <Tabs
            value={window.custom ? '' : String(window.days)}
            onValueChange={handlePresetChange}
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
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant={window.custom ? 'secondary' : 'outline'}
                  size='sm'
                  className='h-8 gap-1.5 px-2.5 text-xs font-normal'
                />
              }
              aria-label={t('Pick a date range')}
            >
              <CalendarIcon
                className='h-3.5 w-3.5 opacity-60'
                aria-hidden='true'
              />
              {window.custom
                ? `${dayjs.unix(window.startTimestamp).format('YYYY-MM-DD')} → ${dayjs.unix(window.endTimestamp).format('YYYY-MM-DD')}`
                : t('Custom range')}
            </PopoverTrigger>
            <PopoverContent className='w-auto p-0' align='end'>
              <Calendar
                mode='range'
                numberOfMonths={2}
                captionLayout='dropdown'
                locale={calendarLocale}
                defaultMonth={dayjs.unix(window.startTimestamp).toDate()}
                selected={
                  window.custom
                    ? {
                        from: dayjs.unix(window.startTimestamp).toDate(),
                        to: dayjs.unix(window.endTimestamp).toDate(),
                      }
                    : undefined
                }
                onSelect={handleRangeSelect}
                // Future days hold no traffic, and the floor matches the window
                // ceiling the query itself enforces.
                disabled={{
                  after: dayjs.unix(nowSeconds).toDate(),
                  before: dayjs
                    .unix(nowSeconds - MAX_WINDOW_DAYS * SECONDS_PER_DAY)
                    .toDate(),
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-3 sm:space-y-4'>
          {window.clamped ? (
            <Alert>
              <TriangleAlert aria-hidden='true' />
              <AlertDescription>
                {t(
                  'The requested range exceeded the maximum and was trimmed to the most recent {{days}} days.',
                  { days: MAX_WINDOW_DAYS }
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          <LedgerTable
            windowStart={window.startTimestamp}
            windowEnd={window.endTimestamp}
            windowLabel={windowLabel}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
