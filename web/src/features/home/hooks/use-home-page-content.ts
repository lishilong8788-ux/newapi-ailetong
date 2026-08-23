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
import i18next from 'i18next'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { isHttpUrl } from '@/lib/content-format'

import { getHomePageContent } from '../api'
import type { HomePageContentResponse, HomePageContentResult } from '../types'

const STORAGE_KEY = 'home_page_content'

function readCachedContent(): string | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeCachedContent(content: string | null): void {
  try {
    if (typeof window === 'undefined') return
    if (content) {
      window.localStorage.setItem(STORAGE_KEY, content)
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* empty */
  }
}

/**
 * Custom home page content (Markdown, HTML, or an iframe URL).
 *
 * Cache-first on purpose. The previous implementation flipped `isLoaded` only
 * once the request settled, so returning to the home page rendered a
 * full-screen "Loading…" for a whole round trip even though the markup was
 * already in localStorage — the most visible stutter when navigating back from
 * another public page. Now the cached copy seeds the query as stale-but-usable:
 * it paints on the first frame and revalidates behind the scenes, and repeat
 * visits inside the stale window do not touch the network at all.
 */
export function useHomePageContent(): HomePageContentResult {
  const cached = useRef(readCachedContent()).current
  const notifiedError = useRef<unknown>(null)

  const { data, error } = useQuery({
    queryKey: ['home-page-content'],
    queryFn: async () => {
      const response = await getHomePageContent()
      writeCachedContent(response.success ? (response.data ?? '') : null)
      return response
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    initialData: cached
      ? ({ success: true, data: cached } satisfies HomePageContentResponse)
      : undefined,
    // Force a background revalidation of the seeded copy on the first mount
    // without making the paint wait for it.
    initialDataUpdatedAt: 0,
  })

  useEffect(() => {
    if (!error || notifiedError.current === error) return
    notifiedError.current = error
    // eslint-disable-next-line no-console
    console.error('Failed to load home page content:', error)
    toast.error(i18next.t('Failed to load home page content'))
  }, [error])

  const content = data?.success ? (data.data ?? '') : ''

  return {
    content,
    // Anything to render — cached or fetched — counts as loaded. Only a cold
    // first visit still shows the placeholder, so the default landing page
    // never flashes before we know whether a custom page is configured.
    isLoaded: data !== undefined || !!error,
    isUrl: isHttpUrl(content),
  }
}
