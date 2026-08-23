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

import { mapStatusDataToConfig } from '@/hooks/use-system-config'
import { getStatus } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

export const STATUS_QUERY_KEY = ['status'] as const

const STATUS_STALE_TIME = 5 * 60 * 1000
const STATUS_GC_TIME = 30 * 60 * 1000

// Route guards want a much shorter window than the UI does: they decide whether
// a module still exists, so a stale answer keeps letting people into a page an
// admin has just switched off.
const STATUS_GUARD_STALE_TIME = 30 * 1000

export type StatusRecord = Record<string, unknown>

const STATUS_STORAGE_KEY = 'status'

export function readCachedStatus(): StatusRecord | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(STATUS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StatusRecord) : null
  } catch {
    return null
  }
}

function writeCachedStatus(status: StatusRecord | null): void {
  try {
    if (typeof window !== 'undefined' && status) {
      window.localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(status))
    }
  } catch {
    /* empty */
  }
}

/**
 * Shared descriptor for `/api/status`.
 *
 * Every consumer — the `useStatus` hook, header nav modules, and route
 * `beforeLoad` guards — must go through this so react-query can dedupe the
 * in-flight request and serve the cached payload. Route guards previously
 * called the endpoint directly, which made each navigation (and each
 * `preload: 'intent'` hover) wait on its own round trip.
 */
export function statusQueryOptions() {
  return queryOptions({
    queryKey: STATUS_QUERY_KEY,
    queryFn: async () => {
      const status = ((await getStatus()) ?? null) as StatusRecord | null
      writeCachedStatus(status)
      if (status) {
        try {
          useSystemConfigStore
            .getState()
            .setConfig(mapStatusDataToConfig(status))
        } catch (err) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn('[status] failed to sync system config', err)
          }
        }
      }
      return status
    },
    staleTime: STATUS_STALE_TIME,
    gcTime: STATUS_GC_TIME,
  })
}

/**
 * Resolve status for a route guard.
 *
 * Returns whatever is cached and refreshes behind the navigation rather than
 * awaiting the network: blocking here is exactly the round trip this module
 * exists to remove. `revalidateIfStale` is what keeps that from meaning "up to
 * five minutes out of date" — a cached entry older than 30s still answers the
 * current navigation, but a refresh starts immediately, so a module an admin has
 * just disabled stops being reachable on the next attempt. Only a cold cache
 * actually waits.
 */
export async function ensureStatus(
  queryClient: QueryClient
): Promise<StatusRecord | null> {
  return queryClient.ensureQueryData({
    ...statusQueryOptions(),
    staleTime: STATUS_GUARD_STALE_TIME,
    revalidateIfStale: true,
  })
}
