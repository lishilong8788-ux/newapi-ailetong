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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import type { PricingModel } from '../types'

// An aggregator channel advertises six endpoint dialects for every model it
// carries (common/endpoint_type.go returns a fixed set for channel type 59/60),
// and the pricing endpoint unions them per model. So six is the normal case, not
// an edge one — these tests pin that the panel promotes one and folds five away
// rather than printing a wall of near-identical URLs.
const SIX_TYPES = [
  'openai',
  'openai-response',
  'openai-response-compact',
  'anthropic',
  'gemini',
  'openai-alpha-search',
]

const ENDPOINT_MAP = {
  openai: { path: '/v1/chat/completions', method: 'POST' },
  'openai-response': { path: '/v1/responses', method: 'POST' },
  'openai-response-compact': {
    path: '/v1/responses/compact',
    method: 'POST',
  },
  anthropic: { path: '/v1/messages', method: 'POST' },
  gemini: {
    path: '/v1beta/models/{model}:generateContent',
    method: 'POST',
  },
  'openai-alpha-search': { path: '/v1/alpha/search', method: 'POST' },
}

// `Link` needs a router context this panel never has in isolation; the tests
// care that the key step offers a route to /keys, not how the router renders it.
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { to: string; children?: React.ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: { server_address: 'https://api.example.test' },
    loading: false,
    error: null,
  }),
}))

const getApiKeys = vi.fn()
const fetchTokenKey = vi.fn()
vi.mock('@/features/keys/api', () => ({
  getApiKeys: (...args: unknown[]) => getApiKeys(...args),
  fetchTokenKey: (...args: unknown[]) => fetchTokenKey(...args),
}))

const authState = { user: undefined as { id: number } | undefined }
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ auth: authState }),
}))

const copyToClipboard = vi.fn(async (_text: string) => true)
vi.mock('@/lib/copy-to-clipboard', () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}))

const { ModelApiQuickref } = await import('../components/model-api-quickref')

function buildModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'glm-5.3',
    quota_type: 0,
    model_ratio: 0.1,
    completion_ratio: 6,
    enable_groups: ['default'],
    supported_endpoint_types: SIX_TYPES,
    ...overrides,
  }
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof ModelApiQuickref>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ModelApiQuickref
        model={buildModel()}
        endpointMap={ENDPOINT_MAP}
        {...props}
      />
    </QueryClientProvider>
  )
}

describe('ModelApiQuickref steps', () => {
  test('promotes the first endpoint and folds the rest behind a count', () => {
    renderPanel()

    // Base URL and the preferred dialect are the two things step 1 offers.
    expect(screen.getByText('https://api.example.test')).toBeInTheDocument()
    expect(
      screen.getByText('https://api.example.test/v1/chat/completions')
    ).toBeInTheDocument()

    // The other five are reachable but not printed as URLs yet. The count sits
    // in a tinted pill, so it is the bare number — a count badge carries no
    // parentheses of its own.
    expect(screen.getByText(/Other protocol endpoints/)).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(
      screen.queryByText('https://api.example.test/v1/messages')
    ).not.toBeInTheDocument()
  })

  test('reveals the alternates on request, model name substituted', () => {
    renderPanel()

    fireEvent.click(screen.getByText(/Other protocol endpoints/))

    expect(
      screen.getByText('https://api.example.test/v1/messages')
    ).toBeInTheDocument()
    // `{model}` in the Gemini path is replaced, not printed literally.
    expect(
      screen.getByText(
        'https://api.example.test/v1beta/models/glm-5.3:generateContent'
      )
    ).toBeInTheDocument()
  })

  test('flags only the alpha endpoint as experimental', () => {
    renderPanel()
    fireEvent.click(screen.getByText(/Other protocol endpoints/))

    expect(screen.getAllByText('Experimental')).toHaveLength(1)
  })

  test('puts the model name in its own step', () => {
    renderPanel()

    expect(screen.getByText('Model name')).toBeInTheDocument()
    expect(screen.getByText('glm-5.3')).toBeInTheDocument()
  })

  // `<model>/<code>` is a backend contract (model.SplitModelLineCode): the
  // distributor strips the suffix, pins the request to channels publishing that
  // code, and falls back when the line is down. So the string this step prints is
  // the difference between reaching the line whose prices the reader just read
  // and reaching whichever line the router preferred.
  test('names the pinned line in the model string', () => {
    renderPanel({ lineCode: 'hs10' })

    expect(screen.getByText('glm-5.3/hs10')).toBeInTheDocument()
    expect(screen.queryByText('glm-5.3')).not.toBeInTheDocument()
    expect(screen.getByText(/suffix pins this line/)).toBeInTheDocument()
  })

  // The Gemini dialect carries the model in the URL rather than the body, so the
  // pin has to be in the path too — a bare name there would silently drop it for
  // that one endpoint while step 2 still promised the line.
  test('carries the pin into the model-in-path endpoint', () => {
    renderPanel({ lineCode: 'hs10' })
    fireEvent.click(screen.getByText(/Other protocol endpoints/))

    expect(
      screen.getByText(
        'https://api.example.test/v1beta/models/glm-5.3/hs10:generateContent'
      )
    ).toBeInTheDocument()
  })

  test('says why a line with no code has no suffix to copy', () => {
    renderPanel({ lineCodeMissing: true, routeCount: 3 })

    expect(screen.getByText('glm-5.3')).toBeInTheDocument()
    expect(
      screen.getByText(/reached through automatic routing only/)
    ).toBeInTheDocument()
    // The failover sentence is about picking *for* the reader, which is not the
    // question someone who already picked a line is asking.
    expect(
      screen.queryByText(/retries on the next one/)
    ).not.toBeInTheDocument()
  })

  test('mentions failover only when there is somewhere to fail over to', () => {
    renderPanel({ routeCount: 3 })
    expect(screen.getByText(/retries on the next one/)).toBeInTheDocument()
  })

  test('stays silent about failover on a single-channel model', () => {
    renderPanel({ routeCount: 1 })
    expect(
      screen.queryByText(/retries on the next one/)
    ).not.toBeInTheDocument()
  })

  test('says so plainly when no endpoint is configured', () => {
    renderPanel({ model: buildModel({ supported_endpoint_types: [] }) })

    expect(
      screen.getByText('No endpoint is configured for this model yet.')
    ).toBeInTheDocument()
    // The base URL is still worth offering — it is the half the SDKs need.
    expect(screen.getByText('https://api.example.test')).toBeInTheDocument()
    expect(
      screen.queryByText(/Other protocol endpoints/)
    ).not.toBeInTheDocument()
  })

  test('a lone endpoint gets no alternates disclosure', () => {
    renderPanel({ model: buildModel({ supported_endpoint_types: ['openai'] }) })

    expect(
      screen.queryByText(/Other protocol endpoints/)
    ).not.toBeInTheDocument()
  })
})

describe('ModelApiQuickref key step', () => {
  test('offers key creation to a visitor who is not signed in', async () => {
    authState.user = undefined
    renderPanel()

    expect(
      screen.getByText('Sign in and create an API key to call this model.')
    ).toBeInTheDocument()
    // No token request is worth making without a session.
    expect(getApiKeys).not.toHaveBeenCalled()
  })

  test('masks the key and never renders the real value', async () => {
    authState.user = { id: 7 }
    getApiKeys.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 3, name: 'default token', status: 1, unlimited_quota: true },
        ],
      },
    })

    renderPanel()

    await waitFor(() =>
      expect(screen.getByText('default token')).toBeInTheDocument()
    )
    expect(screen.getByText(/^sk-•+$/)).toBeInTheDocument()
    // The plaintext key is not in the document, and nothing fetched it.
    expect(fetchTokenKey).not.toHaveBeenCalled()
  })

  test('fetches the plaintext only on copy, straight to the clipboard', async () => {
    authState.user = { id: 7 }
    getApiKeys.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 3,
            name: 'default token',
            status: 1,
            unlimited_quota: false,
            remain_quota: 500_000,
          },
        ],
      },
    })
    fetchTokenKey.mockResolvedValue({
      success: true,
      data: { key: 'REALKEY123' },
    })

    renderPanel()
    await waitFor(() =>
      expect(screen.getByText('default token')).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy API key' }))

    await waitFor(() => expect(fetchTokenKey).toHaveBeenCalledWith(3))
    expect(copyToClipboard).toHaveBeenCalledWith('sk-REALKEY123')
    // Still masked after copying: the clipboard got it, the DOM did not.
    expect(screen.queryByText(/REALKEY123/)).not.toBeInTheDocument()
  })

  test('skips an exhausted token in favour of nothing rather than showing it', async () => {
    authState.user = { id: 7 }
    getApiKeys.mockResolvedValue({
      success: true,
      data: { items: [{ id: 4, name: 'dead token', status: 4 }] },
    })

    renderPanel()

    await waitFor(() =>
      expect(
        screen.getByText('You have no enabled API key yet.')
      ).toBeInTheDocument()
    )
  })
})
