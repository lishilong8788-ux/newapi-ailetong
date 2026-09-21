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
import { queryOptions, type QueryClient } from '@tanstack/react-query'

import { getSelf } from '@/lib/api'

export const SELF_QUERY_KEY = ['user-self'] as const

const SELF_STALE_TIME = 30 * 1000

/**
 * Shared descriptor for `GET /api/user/self`.
 *
 * The wallet page, the redemption and affiliate flows, and the legacy rewards
 * card all want the same record, and each used to fetch it for itself. The
 * in-flight dedupe in `http-client` only collapses requests that overlap, so a
 * page mounting these in sequence issued the call several times over — this was
 * the single most rate-limited endpoint in production. One query key, one cache
 * entry, one request.
 */
export function selfQueryOptions<T = unknown>() {
  return queryOptions({
    queryKey: SELF_QUERY_KEY,
    queryFn: async (): Promise<T | null> => {
      const response = await getSelf()
      if (!response?.success) return null
      return (response.data ?? null) as T | null
    },
    staleTime: SELF_STALE_TIME,
  })
}

/**
 * Re-read the record after something has changed it (top-up, redemption,
 * commission transfer). Invalidating rather than refetching keeps a screen with
 * no mounted consumer from paying for a request nobody is waiting on.
 */
export async function refreshSelf(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: SELF_QUERY_KEY })
}
