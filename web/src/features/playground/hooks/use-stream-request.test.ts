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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { ChatCompletionRequest } from '../types'
import { createStreamRequestController } from './use-stream-request'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

type FakeStreamEvent = Event & {
  data?: string
  readyState?: number
  headers?: Record<string, string[]>
}

class FakeStreamSource {
  readyState = 0
  closed = false
  streamed = false
  private listeners = new Map<string, Array<(event: FakeStreamEvent) => void>>()

  addEventListener(type: string, listener: (event: FakeStreamEvent) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close() {
    this.closed = true
  }

  stream() {
    this.streamed = true
  }

  emit(type: string, data?: string) {
    this.dispatch(type, { data })
  }

  /**
   * Mirrors how `sse.js` reports headers: on the `open` event, keys lowercased,
   * every value wrapped in an array.
   */
  emitOpen(headers: Record<string, string[]>) {
    this.dispatch('open', { headers })
  }

  private dispatch(type: string, fields: Partial<FakeStreamEvent>) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ readyState: this.readyState, ...fields } as FakeStreamEvent)
    }
  }
}

const payload: ChatCompletionRequest = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hello' }],
  stream: true,
}

const noopCallbacks = {
  onUpdate: () => undefined,
  onComplete: () => undefined,
  onError: () => undefined,
}

describe('latest-wins stream request coordination', () => {
  test('only creates a stream for the latest header request', async () => {
    const firstHeaders = deferred<Record<string, string>>()
    const secondHeaders = deferred<Record<string, string>>()
    let headerRequest = 0
    const sources: FakeStreamSource[] = []
    const controller = createStreamRequestController({
      getHeaders: () => {
        headerRequest += 1
        return headerRequest === 1
          ? firstHeaders.promise
          : secondHeaders.promise
      },
      createSource: () => {
        const source = new FakeStreamSource()
        sources.push(source)
        return source
      },
      setStreaming: () => undefined,
    })

    const first = controller.send(payload, noopCallbacks)
    const second = controller.send(payload, noopCallbacks)
    firstHeaders.resolve({ Authorization: 'Bearer stale' })
    await first
    expect(sources.length).toBe(0)

    secondHeaders.resolve({ Authorization: 'Bearer current' })
    await second
    expect(sources.length).toBe(1)
    expect(sources[0]?.streamed).toBe(true)
  })

  test('stop cancels a request that is still waiting for headers', async () => {
    const headers = deferred<Record<string, string>>()
    let sourceCount = 0
    const controller = createStreamRequestController({
      getHeaders: () => headers.promise,
      createSource: () => {
        sourceCount += 1
        return new FakeStreamSource()
      },
      setStreaming: () => undefined,
    })

    const request = controller.send(payload, noopCallbacks)
    controller.stop()
    headers.resolve({ Authorization: 'Bearer ignored' })
    await request

    expect(sourceCount).toBe(0)
  })

  test('dispose cancels a pending header request without a state update', async () => {
    const headers = deferred<Record<string, string>>()
    const streamingStates: boolean[] = []
    let sourceCount = 0
    const controller = createStreamRequestController({
      getHeaders: () => headers.promise,
      createSource: () => {
        sourceCount += 1
        return new FakeStreamSource()
      },
      setStreaming: (streaming) => streamingStates.push(streaming),
    })

    const request = controller.send(payload, noopCallbacks)
    controller.dispose()
    headers.resolve({ Authorization: 'Bearer ignored' })
    await request

    expect(sourceCount).toBe(0)
    expect(streamingStates).toEqual([false])
  })

  test('closes the previous source and ignores all of its later events', async () => {
    const nextHeaders = deferred<Record<string, string>>()
    let headerRequest = 0
    const sources: FakeStreamSource[] = []
    const updates: string[] = []
    const controller = createStreamRequestController({
      getHeaders: () => {
        headerRequest += 1
        if (headerRequest === 1) {
          return Promise.resolve({ Authorization: 'Bearer first' })
        }
        return nextHeaders.promise
      },
      createSource: () => {
        const source = new FakeStreamSource()
        sources.push(source)
        return source
      },
      setStreaming: () => undefined,
    })
    const callbacks = {
      onUpdate: (_type: 'reasoning' | 'content', chunk: string) =>
        updates.push(chunk),
      onComplete: () => undefined,
      onError: () => undefined,
    }

    await controller.send(payload, callbacks)
    const second = controller.send(payload, callbacks)
    expect(sources[0]?.closed).toBe(true)
    sources[0]?.emit(
      'message',
      JSON.stringify({ choices: [{ delta: { content: 'stale' } }] })
    )

    nextHeaders.resolve({ Authorization: 'Bearer second' })
    await second
    sources[1]?.emit(
      'message',
      JSON.stringify({ choices: [{ delta: { content: 'current' } }] })
    )

    expect(updates).toEqual(['current'])
  })
})

function controllerWithSource(sources: FakeStreamSource[]) {
  return createStreamRequestController({
    getHeaders: () => Promise.resolve({ Authorization: 'Bearer test' }),
    createSource: (_payload, headers) => {
      const source = new FakeStreamSource()
      sentHeaders.push(headers)
      sources.push(source)
      return source
    },
    setStreaming: () => undefined,
  })
}

let sentHeaders: Array<Record<string, string>> = []

beforeEach(() => {
  sentHeaders = []
})

describe('response header reporting', () => {
  test('reports headers from the open event, flattened to one value per key', async () => {
    const sources: FakeStreamSource[] = []
    const received: Array<Record<string, string>> = []
    await controllerWithSource(sources).send(payload, {
      ...noopCallbacks,
      onHeaders: (headers) => received.push(headers),
    })

    sources[0]?.emitOpen({
      'x-new-api-channel-id': ['12'],
      'x-new-api-channel-code': ['hs4'],
      'x-new-api-channel-pinned': ['1'],
    })

    expect(received).toEqual([
      {
        'x-new-api-channel-id': '12',
        'x-new-api-channel-code': 'hs4',
        'x-new-api-channel-pinned': '1',
      },
    ])
  })

  test('does not report anything for an open event carrying no headers', async () => {
    const sources: FakeStreamSource[] = []
    let calls = 0
    await controllerWithSource(sources).send(payload, {
      ...noopCallbacks,
      onHeaders: () => {
        calls += 1
      },
    })

    sources[0]?.emit('open')

    expect(calls).toBe(0)
  })
})

describe('the pinned channel request header', () => {
  test('is merged into the auth headers when a channel is pinned', async () => {
    await controllerWithSource([]).send(payload, noopCallbacks, {
      'X-New-Api-Channel-Id': '12',
    })

    expect(sentHeaders[0]).toEqual({
      Authorization: 'Bearer test',
      'X-New-Api-Channel-Id': '12',
    })
  })

  // Automatic routing is the default path, so it has to be byte-for-byte what it
  // was before pinning existed: no channel header, not an empty one.
  test('is absent entirely when no channel is pinned', async () => {
    await controllerWithSource([]).send(payload, noopCallbacks)

    expect(sentHeaders[0]).toEqual({ Authorization: 'Bearer test' })
  })
})

describe('client-side time to first token', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('measures from the moment the request went on the wire', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const sources: FakeStreamSource[] = []
    const measured: number[] = []
    await controllerWithSource(sources).send(payload, {
      ...noopCallbacks,
      onFirstToken: (ttftMs) => measured.push(ttftMs),
    })

    vi.setSystemTime(1_402)
    sources[0]?.emit(
      'message',
      JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })
    )

    expect(measured).toEqual([402])
  })

  /*
   * Reasoning counts. `pkg/perf_metrics` stops its clock on the first streamed
   * chunk without inspecting it, so scoring only `content` would measure a
   * different event than the figure on the channel card and make the comparison
   * the debug panel exists for meaningless.
   */
  test('counts a reasoning chunk as the first token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    const sources: FakeStreamSource[] = []
    const measured: number[] = []
    await controllerWithSource(sources).send(payload, {
      ...noopCallbacks,
      onFirstToken: (ttftMs) => measured.push(ttftMs),
    })

    vi.setSystemTime(5_120)
    sources[0]?.emit(
      'message',
      JSON.stringify({ choices: [{ delta: { reasoning_content: 'hmm' } }] })
    )

    expect(measured).toEqual([120])
  })

  /*
   * The opening frame of an OpenAI stream is usually a bare `role` delta with no
   * text. It still counts, because `stream_scanner.go` stamps the backend's
   * first-response time on the first non-`[DONE]` frame without parsing it — so
   * skipping it here would put this measurement and the published one on
   * different clocks.
   */
  test('counts an opening frame that carries no text', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    const sources: FakeStreamSource[] = []
    const measured: number[] = []
    await controllerWithSource(sources).send(payload, {
      ...noopCallbacks,
      onFirstToken: (ttftMs) => measured.push(ttftMs),
    })

    vi.setSystemTime(2_060)
    sources[0]?.emit(
      'message',
      JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })
    )

    expect(measured).toEqual([60])
  })

  // `[DONE]` is the stream terminator, not a token — and the backend excludes it
  // explicitly. A stream that produced nothing has no first-token time at all.
  test('does not count the done terminator as a token', async () => {
    const sources: FakeStreamSource[] = []
    const measured: number[] = []
    await controllerWithSource(sources).send(payload, {
      ...noopCallbacks,
      onFirstToken: (ttftMs) => measured.push(ttftMs),
    })

    sources[0]?.emit('message', '[DONE]')

    expect(measured).toEqual([])
  })

  test('reports once, not on every later chunk', async () => {
    const sources: FakeStreamSource[] = []
    const measured: number[] = []
    await controllerWithSource(sources).send(payload, {
      ...noopCallbacks,
      onFirstToken: (ttftMs) => measured.push(ttftMs),
    })

    const chunk = JSON.stringify({ choices: [{ delta: { content: 'a' } }] })
    sources[0]?.emit('message', chunk)
    sources[0]?.emit('message', chunk)

    expect(measured.length).toBe(1)
  })
})
