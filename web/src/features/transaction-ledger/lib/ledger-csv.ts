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
import { vendorLabel } from './ledger-filter'
import type { LedgerRow } from '../types'

const HEADERS = [
  'time',
  'request_id',
  'user_id',
  'username',
  'token_name',
  'model',
  'upstream_model',
  'vendor',
  'channel_id',
  'channel_name',
  'line_code',
  'prompt_tokens',
  'completion_tokens',
  'revenue_quota',
  'cost_quota',
  'profit_quota',
  'margin_rate',
  'cost_source',
  'price_source',
] as const

/**
 * Escapes one CSV field.
 *
 * A leading =, +, - or @ is prefixed with a tab: spreadsheet software reads
 * those as formulas, and a model or line code beginning with one would be
 * executed on open rather than displayed.
 */
function escapeField(value: string | number | null): string {
  if (value == null) return ''
  let text = String(value)
  if (/^[=+\-@]/.test(text)) {
    text = `\t${text}`
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

/**
 * Serializes the ledger to CSV.
 *
 * Quota stays in its native unit rather than a formatted currency string: the
 * display currency is a per-viewer setting, and baking "$0.0012" into an export
 * makes the numbers unaddable in a spreadsheet. Unpriced rows leave cost,
 * profit and margin empty — a 0 there would be read as a free request.
 */
export function toLedgerCsv(rows: LedgerRow[]): string {
  const lines = [HEADERS.join(',')]

  for (const row of rows) {
    lines.push(
      [
        escapeField(new Date(row.createdAt * 1000).toISOString()),
        escapeField(row.requestId),
        escapeField(row.userId),
        escapeField(row.username),
        escapeField(row.tokenName),
        escapeField(row.modelName),
        escapeField(row.upstreamModelName),
        escapeField(vendorLabel(row.channelType)),
        escapeField(row.channelId),
        escapeField(row.channelName),
        escapeField(row.lineCode),
        escapeField(row.promptTokens),
        escapeField(row.completionTokens),
        escapeField(row.revenueQuota),
        escapeField(row.costQuota),
        escapeField(row.profitQuota),
        escapeField(row.marginRate == null ? null : row.marginRate.toFixed(6)),
        escapeField(row.costSource),
        escapeField(row.priceSource),
      ].join(',')
    )
  }

  return lines.join('\r\n')
}
