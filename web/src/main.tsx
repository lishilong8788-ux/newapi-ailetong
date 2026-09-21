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
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import i18next from 'i18next'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { toast } from 'sonner'

import { getStatus } from '@/lib/api'
import { installBuildMetadata } from '@/lib/build-metadata'
import { applyFaviconToDom } from '@/lib/dom-utils'
import '@/lib/dayjs'
import { initializeFrontendCache } from '@/lib/frontend-cache'
import { handleServerError } from '@/lib/handle-server-error'

import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
import './i18n/config'
// Generated Routes
import { routeTree } from './routeTree.gen'

// Styles
import './styles/index.css'

// Ensure VChart theme is initialized before any chart mounts (prevents white default theme flash)
// VChart theme is driven by our ThemeProvider (html.light/html.dark) via per-chart `theme` prop.
initializeFrontendCache()
installBuildMetadata()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.log({ failureCount, error })

        if (failureCount >= 0 && import.meta.env.DEV) return false
        if (failureCount > 3 && import.meta.env.PROD) return false

        // 429 belongs on this list, not because retrying is pointless but
        // because it is actively harmful: a page like cost analytics fires five
        // queries at once, so retrying each of them four times turns one
        // rate-limit hit into ~20 requests and keeps the window closed.
        return !(
          error instanceof AxiosError &&
          [401, 403, 429].includes(error.response?.status ?? 0)
        )
      },
      // Keep focused tabs from silently re-running heavy pages like logs.
      refetchOnWindowFocus: false,
      staleTime: 10 * 1000, // 10s
    },
    mutations: {
      onError: (error) => {
        handleServerError(error)

        if (error instanceof AxiosError) {
          if (error.response?.status === 304) {
            toast.error(i18next.t('Content not modified!'))
          }
        }
      },
    },
  },
  queryCache: new QueryCache({
    // Report, never navigate. This hook fires for *every* query in the app, so
    // routing from here let one failed background query throw the user off the
    // page they were reading — the crash looked like the page itself had died.
    // Pages own their error state (see the `failed` branch in cost analytics);
    // all this handler owes the user is a notice.
    onError: (error) => {
      if (error instanceof AxiosError && error.response?.status === 500) {
        toast.error(i18next.t('Internal Server Error!'))
      }
    },
  }),
})

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  // A preloaded match stays valid for 30s. With 0 (the previous value) every
  // hover re-ran `beforeLoad`, so sweeping the header nav fired a guard round
  // trip per item and the subsequent click paid for yet another one.
  defaultPreloadStaleTime: 30_000,
  // Don't preload on a pointer that is merely passing over a link on its way
  // somewhere else.
  defaultPreloadDelay: 120,
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.querySelector<HTMLElement>('#root')
if (!rootElement) {
  throw new Error('Root element not found')
}
// Set document.title and favicon from cached status, then refresh from network
;(function initSystemBranding() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const apply = (name: string) => {
      document.title = name
      const metaTitle = document.querySelector(
        'meta[name="title"]'
      ) as HTMLMetaElement | null
      if (metaTitle) metaTitle.setAttribute('content', name)
    }
    // Cache-first
    try {
      const saved = localStorage.getItem('status')
      if (saved) {
        const s = JSON.parse(saved)
        if (s?.system_name) apply(s.system_name)
        if (s?.logo) applyFaviconToDom(s.logo)
      }
    } catch {
      /* empty */
    }
    // Background refresh
    getStatus()
      .then((s) => {
        if (s?.system_name) {
          apply(s.system_name as string)
          try {
            localStorage.setItem('status', JSON.stringify(s))
          } catch {
            /* empty */
          }
        }
        if (s?.logo) applyFaviconToDom(s.logo as string)
      })
      .catch(() => {
        /* empty */
      })
  } catch {
    /* empty */
  }
})()
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              <RouterProvider router={router} />
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )

  warmPublicRoutes()
}

/**
 * Pull the header-reachable public routes into cache once the app is idle.
 *
 * Route components are code-split in production, so the first click on a nav
 * item paid for a chunk download before anything could render — the delay reads
 * as a stutter no amount of animation tuning can hide. `preloadRoute` fetches
 * the chunk and runs the route's loaders, both of which are then cache hits when
 * the user actually navigates. Failures are ignored: this is opportunistic, and
 * a disabled module simply redirects when preloaded.
 */
function warmPublicRoutes() {
  const paths = ['/', '/pricing', '/rankings', '/about'] as const

  const warm = () => {
    for (const to of paths) {
      void router.preloadRoute({ to }).catch(() => {
        /* opportunistic */
      })
    }
  }

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warm, { timeout: 3000 })
  } else {
    window.setTimeout(warm, 1500)
  }
}
