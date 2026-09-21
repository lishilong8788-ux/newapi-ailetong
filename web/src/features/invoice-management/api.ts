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
  InvoiceAttachment,
  InvoiceRequestDetail,
  IssueInvoicePayload,
  ListInvoiceRequestsParams,
  ListInvoiceRequestsResponse,
  RejectInvoicePayload,
} from './types'

// ============================================================================
// Invoice Review (admin)
// ============================================================================

export async function listInvoiceRequests(
  params: ListInvoiceRequestsParams = {}
): Promise<ListInvoiceRequestsResponse> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  query.set('status', params.status ?? '')
  query.set('keyword', params.keyword ?? '')
  const res = await api.get(`/api/invoice/admin?${query.toString()}`)
  return res.data
}

export async function getInvoiceRequest(
  id: number
): Promise<ApiResponse<InvoiceRequestDetail>> {
  const res = await api.get(`/api/invoice/admin/${id}`)
  return res.data
}

export async function issueInvoiceRequest(
  id: number,
  payload: IssueInvoicePayload
): Promise<ApiResponse> {
  const res = await api.post(`/api/invoice/admin/${id}/issue`, payload)
  return res.data
}

export async function rejectInvoiceRequest(
  id: number,
  payload: RejectInvoicePayload
): Promise<ApiResponse> {
  const res = await api.post(`/api/invoice/admin/${id}/reject`, payload)
  return res.data
}

export async function resendInvoiceEmail(id: number): Promise<ApiResponse> {
  const res = await api.post(`/api/invoice/admin/${id}/resend`)
  return res.data
}

// ============================================================================
// Invoice attachments (admin)
// ============================================================================

/**
 * Uploads one invoice document. Sent as multipart under the field name the
 * handler reads; the Content-Type boundary is left to the browser.
 */
export async function uploadInvoiceAttachment(
  id: number,
  file: File
): Promise<ApiResponse<InvoiceAttachment>> {
  const body = new FormData()
  body.append('file', file)
  const res = await api.post(`/api/invoice/admin/${id}/attachment`, body)
  return res.data
}

export async function deleteInvoiceAttachment(
  id: number,
  attachmentId: number
): Promise<ApiResponse> {
  const res = await api.delete(
    `/api/invoice/admin/${id}/attachment/${attachmentId}`
  )
  return res.data
}

/** Opened in a new tab; the server sets the download headers. */
export function invoiceAttachmentDownloadUrl(
  id: number,
  attachmentId: number
): string {
  return `/api/invoice/admin/${id}/attachment/${attachmentId}`
}

/**
 * Streams the pending-invoice worksheet as CSV. Returned as a Blob so the
 * caller can hand it straight to a download anchor.
 */
export async function exportPendingInvoices(): Promise<Blob> {
  const res = await api.get('/api/invoice/admin/export', {
    responseType: 'blob',
    skipBusinessError: true,
  })
  return res.data as Blob
}
