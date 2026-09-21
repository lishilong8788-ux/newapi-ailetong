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

import { getModelChannelPricing } from '../api'

/**
 * Per-channel price tiers for one model.
 *
 * Keyed per model rather than fetched with the catalog: the channel list is only
 * ever shown inside one model's detail view, and a per-model request keeps the
 * catalog payload from growing by every channel of every model.
 *
 * `retry: false` because the endpoint is display-only. A model whose channels
 * cannot be listed still has a full set of per-group prices above it, so the card
 * simply does not render — retrying would delay a page that is already usable.
 */
export function useChannelPricing(modelName: string | undefined) {
  const query = useQuery({
    queryKey: ['pricing-channels', modelName],
    queryFn: () => getModelChannelPricing(modelName as string),
    enabled: Boolean(modelName),
    staleTime: 60 * 1000,
    retry: false,
  })

  return {
    routes: query.data?.success ? (query.data.data ?? []) : [],
    autoRoute: query.data?.auto_route,
    isLoading: query.isLoading,
    error: query.error,
  }
}
