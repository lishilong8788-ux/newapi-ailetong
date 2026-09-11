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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ROLE } from '@/lib/roles'
import { STATUS_QUERY_KEY, type StatusRecord } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => '/',
}))

const { useSidebarView } = await import('../use-sidebar-view')

/**
 * Renders the sidebar with a pre-seeded `/api/status` payload. The status query
 * is seeded rather than mocked so the real `useStatus` -> `statusQueryOptions`
 * path runs; a fresh cache entry keeps the query function from reaching the
 * network.
 */
function renderSidebar(status: StatusRecord | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (status) queryClient.setQueryData(STATUS_QUERY_KEY, status)

  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'agent-candidate',
    role: ROLE.USER,
  })

  return renderHook(() => useSidebarView(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

function referralItemUrls(
  navGroups: ReturnType<typeof useSidebarView>['navGroups']
) {
  return navGroups
    .flatMap((group) => group.items)
    .map((item) => ('url' in item ? item.url : undefined))
    .filter((url) => url === '/agent')
}

afterEach(() => {
  useAuthStore.getState().auth.setUser(null)
})

describe('sidebar gating on a status feature flag', () => {
  test('shows the referral entry when agent_enabled is true', () => {
    const { result } = renderSidebar({ agent_enabled: true })

    expect(referralItemUrls(result.current.navGroups)).toEqual(['/agent'])
  })

  test('hides the referral entry when agent_enabled is false', () => {
    const { result } = renderSidebar({ agent_enabled: false })

    expect(referralItemUrls(result.current.navGroups)).toEqual([])
  })

  test('hides the referral entry when status has not arrived yet', () => {
    const { result } = renderSidebar(null)

    expect(referralItemUrls(result.current.navGroups)).toEqual([])
  })

  test('leaves entries without a status flag visible while the flag is off', () => {
    const { result } = renderSidebar({ agent_enabled: false })

    const urls = result.current.navGroups
      .flatMap((group) => group.items)
      .map((item) => ('url' in item ? item.url : undefined))

    expect(urls).toContain('/wallet')
    expect(urls).toContain('/profile')
  })
})
