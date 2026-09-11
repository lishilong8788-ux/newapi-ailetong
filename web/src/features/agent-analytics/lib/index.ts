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
export {
  agentLabel,
  bucketKey,
  bucketTrend,
  buildCsvRow,
  buildRanking,
  buildScatterModel,
  classifyQuadrant,
  computeEffectiveRate,
  computePayingRate,
  countDormant,
  CSV_HEADER_KEYS,
  hasNeverEarned,
  isDormant,
  median,
  normalizeGranularity,
  resolveWindow,
  safeRate,
  toCsv,
  windowDays,
} from './analytics'
export { chartAxisTokens, datumNumber, datumString } from './chart-theme'
export {
  daysSince,
  formatCommissionDate,
  formatCount,
  formatRate,
  formatRmb,
  formatRmbCompact,
} from './format'
