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
import { parseLogOther } from '@/features/usage-logs/lib/format'
import type { UsageLog } from '@/features/usage-logs/data/schema'

import type { LedgerGrade, LedgerRow } from '../types'

/**
 * Cost grades that carry a real number.
 *
 * Anything else — including the absence of a snapshot and the explicit
 * 'unknown' — means the request was never priced against the vendor. The
 * backend still writes cost_quota 0 in that case (see ComputeUpstreamCost), so
 * the grade, not the value, is what decides whether a cost exists.
 */
const KNOWN_COST_SOURCES = new Set(['exact', 'reported', 'markup', 'official'])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Flattens one log row into a transaction.
 *
 * Cost, margin and route are read from the row's own columns, not from the JSON
 * snapshot. The write path (model.applyMarginColumns) is what decides whether a
 * snapshot may become a column at all: a task's differential settlement carries
 * the task TOTAL cost while its row holds only the delta, and the submission row
 * already recorded the full cost — so those rows are stored unpriced on purpose.
 * Re-deriving cost from the snapshot here would reintroduce exactly that double
 * count, which is why the snapshot is only consulted for display extras.
 *
 * Revenue is the log's own quota column for the same reason: the snapshot's
 * charged_quota is a task total, and summing it across rows counts a task twice.
 */
export function toLedgerRow(log: UsageLog): LedgerRow {
  const other = parseLogOther(log.other)
  const price = other?.admin_info?.price

  const revenueQuota = isFiniteNumber(log.quota) ? log.quota : 0
  const costKnown =
    KNOWN_COST_SOURCES.has(log.cost_source ?? '') &&
    isFiniteNumber(log.cost_quota)
  const costQuota = costKnown ? log.cost_quota : null
  const profitQuota = costKnown ? log.margin_quota : null

  let grade: LedgerGrade = 'priced'
  if (!costKnown) {
    grade = 'unpriced'
  } else if (revenueQuota === 0) {
    grade = 'free'
  }

  return {
    id: log.id,
    createdAt: log.created_at,
    requestId: log.request_id ?? '',
    userId: log.user_id,
    username: log.username ?? '',
    tokenName: log.token_name ?? '',
    modelName: log.model_name ?? '',
    // Only surfaced when it differs: an upstream name echoing the client name
    // is noise in a table this wide.
    upstreamModelName:
      other?.upstream_model_name && other.upstream_model_name !== log.model_name
        ? other.upstream_model_name
        : '',
    channelId: log.channel ?? 0,
    channelName: log.channel_name ?? '',
    channelType: log.channel_type ?? 0,
    // Column first, snapshot as fallback: rows written before the column existed
    // (and not yet backfilled) still carry it in the JSON.
    lineCode: log.line_code || (price?.line_code ?? ''),
    promptTokens: log.prompt_tokens ?? 0,
    completionTokens: log.completion_tokens ?? 0,
    revenueQuota,
    costQuota,
    profitQuota,
    marginRate:
      profitQuota == null || revenueQuota <= 0
        ? null
        : profitQuota / revenueQuota,
    grade,
    costSource: log.cost_source ?? '',
    priceSource: price?.price_source ?? '',
    sellMarkup: isFiniteNumber(price?.sell_markup) ? price.sell_markup : null,
    isStream: Boolean(log.is_stream),
    useTime: log.use_time ?? 0,
  }
}
