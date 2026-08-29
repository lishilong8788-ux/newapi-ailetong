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
// Invoice Type Definitions
//
// Monetary fields (`amount`, `amount_total`) are integer minor units (cents).
// Never divide them before display — see lib/money.ts.
// ============================================================================

/** Generic API response envelope */
export interface ApiResponse<T = unknown> {
  success?: boolean
  message?: string
  data?: T
}

/** Invoice title kind: personal or company */
export type InvoiceTitleType = 'personal' | 'company'

/** Invoice kind: normal (普通发票) or special (专用发票) */
export type InvoiceType = 'normal' | 'special'

/** Lifecycle status of an invoice request */
export type InvoiceRequestStatus =
  | 'pending'
  | 'issued'
  | 'rejected'
  | 'cancelled'

/** Order kind that can be invoiced */
export type InvoiceSourceType = 'topup' | 'subscription'

/** A saved invoice title (开票资料) */
export interface InvoiceProfile {
  id: number
  user_id: number
  title_type: InvoiceTitleType
  title: string
  tax_no: string
  address: string
  phone: string
  bank_name: string
  bank_account: string
  is_default: boolean
  created_at: number
  updated_at: number
}

/** A paid order that has not been invoiced yet */
export interface InvoiceableOrder {
  source_type: InvoiceSourceType
  source_id: number
  trade_no: string
  /** Minor units (cents) */
  amount: number
  currency: string
  /** Unix timestamp in seconds */
  pay_time: number
}

/** An invoice request submitted by the user */
export interface InvoiceRequest {
  id: number
  user_id: number
  invoice_type: InvoiceType
  status: InvoiceRequestStatus
  profile_id: number
  title_type: InvoiceTitleType
  title: string
  tax_no: string
  address: string
  phone: string
  bank_name: string
  bank_account: string
  /** Minor units (cents) */
  amount_total: number
  currency: string
  recipient_email: string
  remark: string
  invoice_no: string
  pdf_url: string
  reject_reason: string
  trade_no_snapshot: string
  create_time: number
  issue_time: number
  email_sent_at: number
  email_error: string
}

/** One order line inside an invoice request */
export interface InvoiceItem {
  id: number
  request_id: number
  source_type: InvoiceSourceType
  source_id: number
  trade_no: string
  /** Minor units (cents) */
  amount: number
  currency: string
}

// ============================================================================
// Request / response payloads
// ============================================================================

/** Create or update payload for an invoice profile */
export interface InvoiceProfilePayload {
  title_type: InvoiceTitleType
  title: string
  tax_no: string
  address: string
  phone: string
  bank_name: string
  bank_account: string
  is_default: boolean
}

/** One order reference inside an invoice request payload */
export interface InvoiceRequestOrderRef {
  source_type: InvoiceSourceType
  source_id: number
}

/** Create payload for an invoice request */
export interface InvoiceRequestPayload {
  profile_id: number
  invoice_type: InvoiceType
  recipient_email: string
  remark: string
  orders: InvoiceRequestOrderRef[]
}

/** Paginated invoice request list */
export interface InvoiceRequestListData {
  items: InvoiceRequest[]
  total: number
}

/** Invoice request with its order lines */
export interface InvoiceRequestDetailData {
  request: InvoiceRequest
  items: InvoiceItem[]
}

/**
 * One currency's invoicing position, aggregated server-side.
 *
 * The request list is paginated, so these totals cannot be derived from the rows
 * on screen — they come from `GET /api/invoice/summary`.
 */
export interface InvoiceAmountSummary {
  currency: string
  /** Pending + processing applications, in minor units */
  pending_minor: number
  /** Issued applications only, in minor units */
  issued_minor: number
  /** Paid amount still free to claim, in minor units */
  invoiceable_minor: number
}

/** Query params for the self invoice request list */
export interface InvoiceRequestListParams {
  p: number
  page_size: number
  status?: string
  keyword?: string
}
