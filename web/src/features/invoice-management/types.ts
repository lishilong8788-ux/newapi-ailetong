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

// ============================================================================
// Domain Types
// ============================================================================

export type InvoiceType = 'normal' | 'special'

export type InvoiceStatus = 'pending' | 'issued' | 'rejected' | 'cancelled'

export type InvoiceTitleType = 'personal' | 'company'

export type InvoiceItemSourceType = 'topup' | 'subscription'

/**
 * A single invoice request awaiting manual handling by finance.
 *
 * `amount_total` is denominated in the minor currency unit (cents) to keep the
 * wire format integral; use `formatInvoiceAmount` before display.
 */
export interface InvoiceRequest {
  id: number
  user_id: number
  invoice_type: InvoiceType
  status: InvoiceStatus
  profile_id: number
  title_type: InvoiceTitleType
  title: string
  tax_no: string
  address: string
  phone: string
  bank_name: string
  bank_account: string
  /** Minor currency unit (cents). */
  amount_total: number
  currency: string
  recipient_email: string
  remark: string
  invoice_no: string
  pdf_url: string
  reject_reason: string
  /** Comma-separated trade numbers captured when the request was created. */
  trade_no_snapshot: string
  create_time: number
  issue_time: number
  email_sent_at: number
  email_error: string
  /** Applicant's username, joined server-side for the admin list only. */
  username?: string
}

export interface InvoiceItem {
  id: number
  request_id: number
  source_type: InvoiceItemSourceType
  source_id: number
  trade_no: string
  /** Minor currency unit (cents). */
  amount: number
  currency: string
  /** When the order was paid, snapshotted at request creation. */
  pay_time: number
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface ListInvoiceRequestsParams {
  p?: number
  page_size?: number
  status?: string
  keyword?: string
}

export interface ListInvoiceRequestsResponse {
  success: boolean
  message?: string
  data?: {
    items: InvoiceRequest[]
    total: number
  }
}

export interface InvoiceRequestDetail {
  request: InvoiceRequest
  items: InvoiceItem[]
}

export interface IssueInvoicePayload {
  invoice_no: string
  pdf_url: string
  issue_date?: string
  notify_email: boolean
}

export interface RejectInvoicePayload {
  reason: string
}

// ============================================================================
// Dialog Types
// ============================================================================

export type InvoicesDialogType = 'issue' | 'reject'
