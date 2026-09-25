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
import { useMemo } from 'react'

import { getChannels } from '@/features/channels/api'
import { channelsQueryKeys } from '@/features/channels/lib'
import type { Channel } from '@/features/channels/types'
import { getModels } from '@/features/models/api'
import { modelsQueryKeys } from '@/features/models/lib'
import type { Model } from '@/features/models/types'
import { usePricingData } from '@/features/pricing/hooks'

import {
  buildCatalog,
  countCatalogStatuses,
  groupCatalogByVendor,
} from '../lib/build-catalog'

/** `common.GetPageQuery` clamps `page_size` to 100, so the list has to be paged. */
const CHANNEL_PAGE_SIZE = 100

/**
 * Cap on pages fetched. Ten pages is 1000 channels; past that the channel counts
 * are reported as partial rather than silently undercounted. An install that
 * large needs a server-side aggregate, which is a backend change this read-only
 * view deliberately does not require.
 */
const MAX_CHANNEL_PAGES = 10

type ChannelFetchResult = { channels: Channel[]; truncated: boolean }

/**
 * Every channel, across pages. Page 1 carries `total`, so the remaining pages
 * are known up front and fetched together instead of walked one at a time.
 */
async function fetchAllChannels(): Promise<ChannelFetchResult> {
  const first = await getChannels({ p: 1, page_size: CHANNEL_PAGE_SIZE })
  const channels = [...(first.data?.items ?? [])]
  const total = first.data?.total ?? channels.length

  const pageCount = Math.ceil(total / CHANNEL_PAGE_SIZE)
  const fetchable = Math.min(pageCount, MAX_CHANNEL_PAGES)

  const rest = await Promise.all(
    Array.from({ length: Math.max(fetchable - 1, 0) }, (_, index) =>
      getChannels({ p: index + 2, page_size: CHANNEL_PAGE_SIZE })
    )
  )
  for (const page of rest) {
    channels.push(...(page.data?.items ?? []))
  }

  return { channels, truncated: pageCount > fetchable }
}

/**
 * Every model metadata row, across pages.
 *
 * Needed for its `id`: `/api/pricing` identifies a model only by name, and the
 * editor writes by id. Paged the same way and for the same reason as the channel
 * list — the page size is clamped server-side.
 */
async function fetchAllModelRows(): Promise<Model[]> {
  const first = await getModels({ p: 1, page_size: CHANNEL_PAGE_SIZE })
  const rows = [...(first.data?.items ?? [])]
  const total = first.data?.total ?? rows.length

  const pageCount = Math.ceil(total / CHANNEL_PAGE_SIZE)
  const fetchable = Math.min(pageCount, MAX_CHANNEL_PAGES)

  const rest = await Promise.all(
    Array.from({ length: Math.max(fetchable - 1, 0) }, (_, index) =>
      getModels({ p: index + 2, page_size: CHANNEL_PAGE_SIZE })
    )
  )
  for (const page of rest) {
    rows.push(...(page.data?.items ?? []))
  }

  return rows
}

/**
 * The catalog: what is on sale, joined with what the channels are configured to
 * serve.
 *
 * Both halves are needed and neither substitutes for the other — see
 * `buildCatalog`. The channel half is also what supplies the per-model channel
 * counts in the left rail, which is why it is fetched once for the whole page
 * rather than per selected model.
 */
export function useCatalogData() {
  const pricing = usePricingData()

  // Keyed under the channels feature's own list namespace so a save from the
  // channel drawer — which invalidates `channelsQueryKeys.lists()` — refreshes
  // this page too. A private key would leave the supply table showing the state
  // from before the edit the operator just made.
  const channelsQuery = useQuery({
    queryKey: [...channelsQueryKeys.lists(), 'catalog'],
    queryFn: fetchAllChannels,
    staleTime: 60 * 1000,
  })

  // Same reasoning for the models namespace: the model drawer invalidates
  // `modelsQueryKeys.lists()` on save.
  const modelRowsQuery = useQuery({
    queryKey: [...modelsQueryKeys.lists(), 'catalog'],
    queryFn: fetchAllModelRows,
    staleTime: 60 * 1000,
  })

  const channels = channelsQuery.data?.channels ?? []
  const modelRows = modelRowsQuery.data ?? []

  const items = useMemo(
    () => buildCatalog(pricing.models, channels, modelRows, pricing.vendors),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricing.models, pricing.vendors, channelsQuery.data, modelRowsQuery.data]
  )

  const vendorGroups = useMemo(() => groupCatalogByVendor(items), [items])
  const statusCounts = useMemo(() => countCatalogStatuses(items), [items])

  return {
    items,
    vendorGroups,
    statusCounts,
    channels,
    modelRows,
    /** True when the install has more channels than this view is willing to page. */
    channelsTruncated: channelsQuery.data?.truncated ?? false,
    groupRatio: pricing.groupRatio,
    usableGroup: pricing.usableGroup,
    endpointMap: pricing.endpointMap,
    priceRate: pricing.priceRate,
    usdExchangeRate: pricing.usdExchangeRate,
    isLoading:
      pricing.isLoading || channelsQuery.isLoading || modelRowsQuery.isLoading,
    error: pricing.error ?? channelsQuery.error ?? modelRowsQuery.error,
  }
}
