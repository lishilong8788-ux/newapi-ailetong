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
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Message } from '../../../types'

const getModelChannelPricing = vi.fn()
vi.mock('@/features/pricing/api', () => ({
  getModelChannelPricing: () => getModelChannelPricing(),
}))

const { MessageDebugPanel } = await import('../message-debug-panel')

function reply(overrides: Partial<Message> = {}): Message {
  return {
    key: 'assistant-1',
    from: 'assistant',
    versions: [{ id: 'v1', content: 'hello' }],
    status: 'complete',
    durationMs: 2_180,
    ...overrides,
  }
}

/**
 * One labelled row, so a figure can be asserted where it belongs.
 *
 * The first-token time appears twice by design — once as a raw timing, once as
 * the right-hand side of the comparison — so an unscoped query cannot tell which
 * row is under test.
 */
function debugRow(label: string): HTMLElement {
  const term = screen.getByText(label)
  const row = term.parentElement

  if (!row) throw new Error(`debug row "${label}" has no container`)

  return row
}

function renderPanel(props: {
  message: Message
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  requestId?: string
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MessageDebugPanel
        message={props.message}
        modelName='glm-5.2'
        requestId={props.requestId}
        usage={props.usage}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getModelChannelPricing.mockResolvedValue({
    success: true,
    data: [
      {
        channel_id: 12,
        code: 'hs4',
        category: 'public_cloud',
        ttft_ms: 380,
        price: { price_source: 'exact', model_ratio: 1 },
      },
    ],
  })
})

/**
 * Whether the pin held.
 *
 * A pin that silently fell through to another line is the failure this panel is
 * meant to catch, so the two outcomes must not read the same. Asserted on both
 * sides — each case checks the other's wording is absent — because a regression
 * here is invisible by construction.
 */
describe('reporting whether the channel was pinned or chosen', () => {
  test('says the user pinned it when the pin was honoured', async () => {
    renderPanel({
      message: reply({ channel: { id: 12, code: 'hs4', pinned: true } }),
    })

    expect(await screen.findByText('You pinned this')).toBeInTheDocument()
    expect(screen.queryByText('Chosen by routing')).not.toBeInTheDocument()
  })

  test('says routing chose it when the pin did not hold', async () => {
    renderPanel({
      message: reply({ channel: { id: 12, code: 'hs4', pinned: false } }),
    })

    expect(await screen.findByText('Chosen by routing')).toBeInTheDocument()
    expect(screen.queryByText('You pinned this')).not.toBeInTheDocument()
  })
})

describe('naming the channel that served the reply', () => {
  test('shows the line code alongside the id', async () => {
    renderPanel({
      message: reply({ channel: { id: 12, code: 'hs4', pinned: true } }),
    })

    expect(await screen.findByText('hs4 (#12)')).toBeInTheDocument()
  })

  // A channel whose model mapping carries no suffix has no code to show.
  test('falls back to the id when there is no line code', async () => {
    renderPanel({ message: reply({ channel: { id: 12, pinned: false } }) })

    expect(await screen.findByText('#12')).toBeInTheDocument()
  })

  // Reading nothing from the headers is a real state while the backend half is
  // built; naming channel 0 would be a guess presented as a fact.
  test('states the channel is unknown rather than guessing one', async () => {
    renderPanel({ message: reply() })

    expect(
      await screen.findByText('The channel for this reply is unknown')
    ).toBeInTheDocument()
    expect(screen.queryByText(/#0/)).not.toBeInTheDocument()
  })

  test('names the supplier category from the published route', async () => {
    renderPanel({
      message: reply({ channel: { id: 12, code: 'hs4', pinned: true } }),
    })

    expect(await screen.findByText('Public cloud')).toBeInTheDocument()
  })
})

/**
 * This run against the figure on the channel card. The only row here that
 * cannot be got anywhere else in the product.
 */
describe('comparing this run to the published first-token time', () => {
  test('shows the card figure, the measurement and the gap', async () => {
    renderPanel({
      message: reply({
        channel: { id: 12, code: 'hs4', pinned: true },
        ttftMs: 402,
      }),
    })

    await screen.findByText('Card estimate')
    const benchmark = within(debugRow('Benchmark'))

    expect(benchmark.getByText('380ms')).toBeInTheDocument()
    expect(benchmark.getByText('402ms')).toBeInTheDocument()
    expect(benchmark.getByText('(+22ms)')).toBeInTheDocument()
  })

  // Without a published figure there is nothing to compare against, and an
  // invented baseline would be worse than none.
  test('shows the measurement alone when the channel publishes no figure', async () => {
    getModelChannelPricing.mockResolvedValue({ success: true, data: [] })
    renderPanel({
      message: reply({ channel: { id: 12, pinned: true }, ttftMs: 402 }),
    })

    await screen.findByText('This run')
    const benchmark = within(debugRow('Benchmark'))

    expect(benchmark.getByText('402ms')).toBeInTheDocument()
    expect(screen.queryByText('Card estimate')).not.toBeInTheDocument()
    expect(screen.queryByText(/\(\+/)).not.toBeInTheDocument()
  })

  // A non-streaming reply arrives whole: there is no first token to observe. The
  // row has to say that, because a blank reads as a failed measurement.
  test('states there is no first token to measure without one', async () => {
    renderPanel({ message: reply({ channel: { id: 12, pinned: true } }) })

    expect(
      await screen.findByText(
        'Non-streaming request, no first token to measure'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('This run')).not.toBeInTheDocument()
  })
})

describe('reporting token usage', () => {
  test('lists input, output and total when the transport reported them', async () => {
    renderPanel({
      message: reply({ channel: { id: 12, pinned: true }, ttftMs: 402 }),
      usage: { prompt_tokens: 12, completion_tokens: 83, total_tokens: 95 },
    })

    expect(await screen.findByText('Usage')).toBeInTheDocument()
    expect(screen.getByText('12 tokens')).toBeInTheDocument()
    expect(screen.getByText('83 tokens')).toBeInTheDocument()
    expect(screen.getByText('95 tokens')).toBeInTheDocument()
  })

  /*
   * A streamed reply carries no usage unless the upstream was asked for it, which
   * is the normal case here. Rendering zeros would claim the reply cost nothing.
   */
  test('renders no usage row at all when nothing was reported', async () => {
    renderPanel({
      message: reply({ channel: { id: 12, pinned: true }, ttftMs: 402 }),
    })

    await screen.findByText('Channel')

    expect(screen.queryByText('Usage')).not.toBeInTheDocument()
    expect(screen.queryByText('0 tokens')).not.toBeInTheDocument()
  })

  // Throughput divides by the generation phase, so it needs a real output count;
  // estimating from character length would invent the figure.
  test('omits the throughput figure without an output token count', async () => {
    renderPanel({
      message: reply({ channel: { id: 12, pinned: true }, ttftMs: 402 }),
    })

    await screen.findByText('Channel')

    expect(screen.queryByText(/token\/s/)).not.toBeInTheDocument()
  })

  test('reports throughput over the generation phase only', async () => {
    renderPanel({
      message: reply({ channel: { id: 12, pinned: true }, ttftMs: 180 }),
      usage: { completion_tokens: 80 },
    })

    // 80 tokens over the 2000ms that followed the first token, not over 2180ms.
    expect(await screen.findByText('40 token/s')).toBeInTheDocument()
  })
})

/**
 * The gateway's own id, from `X-Oneapi-Request-Id`. It is worth a row only
 * because the same value lands in the consume log, so it resolves to something
 * when quoted.
 */
describe('reporting the request id', () => {
  test('shows the id with a way to copy it', async () => {
    renderPanel({
      message: reply({ channel: { id: 12, pinned: true } }),
      requestId: '20260922190312abcdef',
    })

    expect(await screen.findByText('20260922190312abcdef')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  // Nothing is generated client-side to fill the gap: an id the backend never
  // issued would look identical and match no log line.
  test('renders no row when no id was captured', async () => {
    renderPanel({ message: reply({ channel: { id: 12, pinned: true } }) })

    await screen.findByText('Channel')

    expect(screen.queryByText('Request ID')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Copy' })
    ).not.toBeInTheDocument()
  })
})
