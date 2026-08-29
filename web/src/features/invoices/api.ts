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
import { api } from '@/lib/api'

import type {
  ApiResponse,
  InvoiceAmountSummary,
  InvoiceProfile,
  InvoiceProfilePayload,
  InvoiceRequestDetailData,
  InvoiceRequestListData,
  InvoiceRequestListParams,
  InvoiceRequestPayload,
  InvoiceableOrder,
} from './types'

// ============================================================================
// Invoice Profiles
// ============================================================================

export async function getInvoiceProfiles(): Promise<
  ApiResponse<InvoiceProfile[]>
> {
  const res = await api.get('/api/invoice/profile')
  return res.data
}

export async function createInvoiceProfile(
  payload: InvoiceProfilePayload
): Promise<ApiResponse<InvoiceProfile>> {
  const res = await api.post('/api/invoice/profile', payload)
  return res.data
}

export async function updateInvoiceProfile(
  id: number,
  payload: InvoiceProfilePayload
): Promise<ApiResponse<InvoiceProfile>> {
  const res = await api.put(`/api/invoice/profile/${id}`, payload)
  return res.data
}

export async function deleteInvoiceProfile(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/invoice/profile/${id}`)
  return res.data
}

// ============================================================================
// Invoiceable Orders
// ============================================================================

export async function getInvoiceableOrders(): Promise<
  ApiResponse<InvoiceableOrder[]>
> {
  const res = await api.get('/api/invoice/invoiceable-orders')
  return res.data
}

// ============================================================================
// Amount Summary
// ============================================================================

/**
 * The summary header degrades to zeros on failure (see `useInvoiceSummary`), so
 * both interceptor toasts are opted out of here: without them a transient 404
 * or a `success: false` body would surface as a bare "Request failed with
 * status code 404" toast every time the header refreshes.
 */
export async function getInvoiceAmountSummary(): Promise<
  ApiResponse<InvoiceAmountSummary[]>
> {
  const res = await api.get('/api/invoice/summary', {
    skipErrorHandler: true,
    skipBusinessError: true,
  })
  return res.data
}

// ============================================================================
// Invoice Requests
// ============================================================================

export async function createInvoiceRequest(
  payload: InvoiceRequestPayload
): Promise<ApiResponse> {
  const res = await api.post('/api/invoice/request', payload)
  return res.data
}

export async function getSelfInvoiceRequests(
  params: InvoiceRequestListParams
): Promise<ApiResponse<InvoiceRequestListData>> {
  const query = new URLSearchParams({
    p: String(params.p),
    page_size: String(params.page_size),
  })
  if (params.status) query.set('status', params.status)
  if (params.keyword) query.set('keyword', params.keyword)
  const res = await api.get(`/api/invoice/self?${query.toString()}`)
  return res.data
}

export async function getSelfInvoiceRequest(
  id: number
): Promise<ApiResponse<InvoiceRequestDetailData>> {
  const res = await api.get(`/api/invoice/self/${id}`)
  return res.data
}

export async function cancelSelfInvoiceRequest(
  id: number
): Promise<ApiResponse> {
  const res = await api.post(`/api/invoice/self/${id}/cancel`)
  return res.data
}

/** Absolute-safe URL for the PDF download redirect (opened in a new tab). */
export function getSelfInvoiceDownloadUrl(id: number): string {
  return `/api/invoice/self/${id}/download`
}
