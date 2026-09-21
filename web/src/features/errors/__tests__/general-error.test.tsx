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
import { render, screen } from '@testing-library/react'
import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getHttpStatus } from '@/lib/server-error-message'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { go: vi.fn() } }),
}))

const { GeneralError } = await import('../general-error')

function axiosErrorWithStatus(status: number): AxiosError {
  const error = new AxiosError('request failed')
  error.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  }
  return error
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('status extraction', () => {
  test('reads the axios shape', () => {
    expect(getHttpStatus(axiosErrorWithStatus(429))).toBe(429)
  })

  test('reads a bare status carried on the error itself', () => {
    expect(getHttpStatus({ status: 503 })).toBe(503)
    expect(getHttpStatus({ statusCode: 404 })).toBe(404)
  })

  test('ignores values that are not HTTP statuses', () => {
    expect(getHttpStatus(new Error('boom'))).toBeUndefined()
    expect(getHttpStatus({ status: 0 })).toBeUndefined()
    expect(getHttpStatus({ status: 'teapot' })).toBeUndefined()
    expect(getHttpStatus(null)).toBeUndefined()
    expect(getHttpStatus(undefined)).toBeUndefined()
  })
})

describe('what the error page tells the user', () => {
  test('a rate-limited request reports 429, not a server fault', () => {
    render(<GeneralError error={axiosErrorWithStatus(429)} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('429')
    expect(screen.getByText('Too many requests')).toBeInTheDocument()
    expect(
      screen.getByText(/Please wait a moment before trying again/)
    ).toBeInTheDocument()
  })

  test('an explicit status wins over guessing', () => {
    render(<GeneralError status={503} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('503')
  })

  test('a runtime exception still renders, and is logged rather than guessed at', () => {
    // The fallback digit is the honest answer for an error with no status; what
    // must not be lost is the thrown value, which is all there is to debug with.
    const thrown = new TypeError('cannot read properties of undefined')
    render(<GeneralError error={thrown} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('500')
    // eslint-disable-next-line no-console
    expect(console.error).toHaveBeenCalledWith(
      '[error-page] unhandled error',
      expect.objectContaining({ error: thrown, status: undefined })
    )
  })
})
