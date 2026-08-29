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
import { describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { getInvoiceAmountSummary, getSelfInvoiceRequests } from '../api'

describe('invoice amount summary request', () => {
  test('opts out of both interceptor toasts so a failed summary stays silent', async () => {
    // `useInvoiceSummary` swallows the rejection and falls back to zeros, but
    // the response interceptor toasts before the caller ever sees the error, so
    // the opt-out has to travel with the request config.
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ data: { success: true, data: [] } })

    await getInvoiceAmountSummary()

    expect(get).toHaveBeenCalledWith('/api/invoice/summary', {
      skipErrorHandler: true,
      skipBusinessError: true,
    })
  })

  test('leaves the list request on the global error handler', async () => {
    // Only the summary is silent: a failed list is the primary content and must
    // still surface a toast.
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ data: { success: true, data: { items: [] } } })

    await getSelfInvoiceRequests({ p: 1, page_size: 10 })

    expect(get).toHaveBeenCalledWith('/api/invoice/self?p=1&page_size=10')
  })
})
