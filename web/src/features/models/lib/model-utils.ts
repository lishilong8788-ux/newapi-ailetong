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
import type { TFunction } from 'i18next'

import type { TagInputValidator } from '@/components/tag-input'
import { formatTimestampToDate } from '@/lib/format'
import { validateTagInput, type TagRejection } from '@/lib/model-tags'

import { getNameRuleConfig, getQuotaTypeConfig } from '../constants'
import type { NameRule, Model } from '../types'

// ============================================================================
// Time Formatting
// ============================================================================

/**
 * Format timestamp to standard date string (YYYY-MM-DD HH:mm:ss)
 */
export function formatTimestamp(timestamp: number): string {
  if (!timestamp || timestamp === 0) return '-'
  return formatTimestampToDate(timestamp)
}

/**
 * Format relative time
 */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp || timestamp === 0) return 'Never'

  const now = Date.now()
  const time = timestamp * 1000
  const diff = now - time

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return `${seconds} second${seconds !== 1 ? 's' : ''} ago`
}

// ============================================================================
// Tags
// ============================================================================
//
// Parsing and formatting live in `@/lib/model-tags`, which the public catalog
// reads too. There used to be a second comma splitter here; having two meant
// they could disagree, and they did.

/**
 * Turn a `validateTagInput` rejection into a message for the operator.
 *
 * Shared because two editors apply the same rules: the model drawer's tag field
 * and the bulk tagging dialog. `t` is passed in so React callers keep the
 * `useTranslation` binding that re-renders on a language switch.
 */
export function describeTagRejection(
  rejection: TagRejection,
  t: TFunction
): string {
  switch (rejection.reason) {
    case 'empty':
      return t('Tag cannot be empty')
    case 'forbidden-char':
      return t('Tags cannot contain "{{char}}"', { char: rejection.char })
    case 'too-long':
      return t('Tags are limited to {{max}} characters', {
        max: rejection.max,
      })
    case 'duplicate':
      return t('This tag is already added')
    case 'too-many':
      return t('At most {{max}} tags per model', { max: rejection.max })
  }
}

/**
 * Validator for `TagInput` in every model-tag editor.
 *
 * Built once per caller from its `t`, so the widget stays generic: prefill
 * groups hold arbitrary values and pass no validator at all.
 */
export function createModelTagValidator(t: TFunction): TagInputValidator {
  return (candidate, current) => {
    const rejection = validateTagInput(candidate, current)
    return rejection ? describeTagRejection(rejection, t) : null
  }
}

// ============================================================================
// Endpoints Parsing
// ============================================================================

/**
 * Parse endpoints JSON string
 */
export function parseEndpoints(
  endpoints: string | undefined
): Record<string, unknown> | unknown[] | null {
  if (!endpoints || endpoints.trim() === '') return null

  try {
    return JSON.parse(endpoints)
  } catch {
    return null
  }
}

/**
 * Format endpoints to display
 */
export function formatEndpointsDisplay(
  endpoints: string | undefined
): string[] {
  const parsed = parseEndpoints(endpoints)
  if (!parsed) return []

  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.keys(parsed)
  }

  if (Array.isArray(parsed)) {
    return parsed.map(String)
  }

  return []
}

// ============================================================================
// Name Rule Utils
// ============================================================================

/**
 * Get name rule label
 */
export function getNameRuleLabelByRule(rule: NameRule, t: TFunction): string {
  const config = getNameRuleConfig(t)
  return config[rule]?.label || '-'
}

/**
 * Get name rule config by rule
 */
export function getNameRuleConfigByRule(rule: NameRule, t: TFunction) {
  const config = getNameRuleConfig(t)
  return config[rule] || config[0]
}

// ============================================================================
// Quota Type Utils
// ============================================================================

/**
 * Format quota types array
 */
export function formatQuotaTypes(
  quotaTypes: number[] | undefined,
  t: TFunction
): string {
  if (!quotaTypes || quotaTypes.length === 0) return '-'
  const config = getQuotaTypeConfig(t)
  return quotaTypes.map((qt) => config[qt]?.label || String(qt)).join(', ')
}

// ============================================================================
// Model Validation
// ============================================================================

/**
 * Validate model name
 */
export function validateModelName(name: string): boolean {
  return name.trim().length > 0
}

/**
 * Validate endpoints JSON
 */
export function validateEndpointsJSON(endpoints: string): boolean {
  if (!endpoints || endpoints.trim() === '') return true

  try {
    JSON.parse(endpoints)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Model Status Utils
// ============================================================================

/**
 * Check if model is enabled
 */
export function isModelEnabled(model: Model): boolean {
  return model.status === 1
}

/**
 * Check if model syncs with official
 */
export function isModelSyncOfficial(model: Model): boolean {
  return model.sync_official === 1
}
