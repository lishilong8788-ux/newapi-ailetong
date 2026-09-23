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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { CatalogDetail } from './components/catalog-detail'
import { CatalogSidebar } from './components/catalog-sidebar'
import { useCatalogData } from './hooks'
import {
  CATALOG_STATUS_META,
  CATALOG_STATUS_ORDER,
  groupCatalogByVendor,
} from './lib'
import type { CatalogStatus, CatalogStatusCounts } from './types'

const route = getRouteApi('/_authenticated/catalog/')

/**
 * The status counters, doubling as the status filter.
 *
 * A counter an operator cannot act on is just decoration, so clicking one filters
 * the rail to that state. States with nothing in them are still rendered — "0
 * unpriced" is the reassurance an operator came for, and hiding the row would
 * make its absence ambiguous.
 */
function CatalogStatusChips(props: {
  counts: CatalogStatusCounts
  active: CatalogStatus | null
  onChange: (status: CatalogStatus | null) => void
}) {
  const { t } = useTranslation()

  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      {CATALOG_STATUS_ORDER.map((status) => {
        const meta = CATALOG_STATUS_META[status]
        const isActive = props.active === status
        return (
          <button
            key={status}
            type='button'
            aria-pressed={isActive}
            onClick={() => props.onChange(isActive ? null : status)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
              'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              isActive
                ? 'border-primary/45 bg-accent text-accent-foreground'
                : 'border-border/70 text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <span className={cn('size-2 rounded-full', meta.dotClass)} />
            {t(meta.labelKey)}
            <span className='tabular-nums'>{props.counts[status]}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The product catalog: models on the left, the channels that supply the selected
 * one on the right.
 *
 * Deliberately a second lens on the same data rather than a replacement for the
 * channels page. Everything an operator does to a *supplier* — test it, read its
 * balance, rotate its keys, batch-disable it — is channel-shaped and stays there.
 * This page answers the questions that are model-shaped: what am I selling, at
 * what price, from whom, and what is broken.
 */
export function Catalog() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const catalog = useCatalogData()

  const searchTerm = search.q ?? ''
  // An empty string is how the URL spells "no filter" once a chip is toggled off,
  // so it has to normalize to null instead of sitting in state as a fake status.
  const statusFilter = CATALOG_STATUS_ORDER.includes(
    search.status as CatalogStatus
  )
    ? (search.status as CatalogStatus)
    : null

  const setSearch = (next: Partial<{ q: string; status: string; model: string }>) => {
    void navigate({
      search: (previous) => ({ ...previous, ...next }),
      replace: true,
    })
  }

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase()
    return catalog.items.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false
      if (!needle) return true
      return (
        item.modelName.toLowerCase().includes(needle) ||
        item.vendorName.toLowerCase().includes(needle)
      )
    })
  }, [catalog.items, searchTerm, statusFilter])

  const vendorGroups = useMemo(() => groupCatalogByVendor(filtered), [filtered])

  // The selected model is a URL param so a link to a specific product survives a
  // reload and can be pasted into a ticket. It falls back to the first row of the
  // filtered list rather than to nothing, so the right pane is never blank while
  // the rail has content.
  const selectedModel =
    filtered.find((item) => item.modelName === search.model)?.modelName ??
    filtered[0]?.modelName ??
    null
  const selectedItem = filtered.find((item) => item.modelName === selectedModel)

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Product catalog')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <CatalogStatusChips
          counts={catalog.statusCounts}
          active={statusFilter}
          onChange={(status) => setSearch({ status: status ?? '' })}
        />
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {catalog.channelsTruncated && (
          <p className='text-muted-foreground mb-2 text-xs'>
            {t(
              'This install has more channels than this view pages through, so channel counts may be incomplete.'
            )}
          </p>
        )}

        {catalog.isLoading ? (
          <div className='grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]'>
            <Skeleton className='h-full min-h-64 rounded-xl' />
            <Skeleton className='h-full min-h-64 rounded-xl' />
          </div>
        ) : (
          <div className='grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]'>
            <CatalogSidebar
              vendorGroups={vendorGroups}
              totalCount={catalog.items.length}
              matchedCount={filtered.length}
              selectedModel={selectedModel}
              onSelectModel={(modelName) => setSearch({ model: modelName })}
              search={searchTerm}
              onSearchChange={(value) => setSearch({ q: value })}
              className='min-h-0'
            />

            {selectedItem ? (
              <CatalogDetail
                key={selectedItem.modelName}
                item={selectedItem}
                groupRatio={catalog.groupRatio}
                priceRate={catalog.priceRate}
                usdExchangeRate={catalog.usdExchangeRate}
                className='min-h-0'
              />
            ) : (
              <div className='bg-card text-muted-foreground flex min-h-0 items-center justify-center rounded-xl border p-6 text-sm'>
                {t('No models match your search.')}
              </div>
            )}
          </div>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
