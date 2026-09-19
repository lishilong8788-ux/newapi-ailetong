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
import type { TagRegistryIssue } from './model-tag-registry-core'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** i18n keys for the three tag categories, kept out of the tag data itself. */
export const TAG_KIND_LABEL_KEYS: Record<string, string> = {
  promo: 'Promotion',
  capability: 'Capability',
  lifecycle: 'Lifecycle',
}

/**
 * One validation issue as a message for the operator.
 *
 * Wording tracks `pricing_setting.ValidateTagRegistry` so an inline message and
 * a server rejection say the same thing about the same row.
 */
export function formatTagRegistryIssue(
  t: Translate,
  issue: TagRegistryIssue
): string {
  switch (issue.code) {
    case 'too-many-entries':
      return t('At most {{max}} tags can be configured, currently {{count}}.', {
        max: issue.params?.max,
        count: issue.params?.count,
      })
    case 'slug-required':
      return t('Tag identifier is required')
    case 'slug-too-long':
      return t('Tag identifier cannot exceed {{max}} characters', {
        max: issue.params?.max,
      })
    case 'slug-forbidden-char':
      return t('Tag identifier cannot contain the separator {{char}}', {
        char: issue.params?.char,
      })
    case 'slug-duplicate':
      return t('Another tag already uses the identifier {{slug}}', {
        slug: issue.params?.slug,
      })
    case 'unknown-color':
      return t('Unsupported color: {{color}}', { color: issue.params?.color })
    case 'unknown-kind':
      return t('Unsupported category: {{kind}}', { kind: issue.params?.kind })
    case 'label-required':
      return t('An English display name is required, it is the fallback')
    case 'label-too-long':
      return t('Display name cannot exceed {{max}} characters', {
        max: issue.params?.max,
      })
    case 'too-many-aliases':
      return t('At most {{max}} aliases are allowed', { max: issue.params?.max })
    case 'alias-too-long':
      return t('Alias {{alias}} cannot exceed {{max}} characters', {
        alias: issue.params?.alias,
        max: issue.params?.max,
      })
    case 'alias-forbidden-char':
      return t('Alias {{alias}} cannot contain the separator {{char}}', {
        alias: issue.params?.alias,
        char: issue.params?.char,
      })
    case 'alias-conflicts-slug':
      return t('Alias {{alias}} collides with another tag identifier', {
        alias: issue.params?.alias,
      })
    case 'alias-duplicate':
      return t('Alias {{alias}} is already used by another tag', {
        alias: issue.params?.alias,
      })
    default:
      return t('Invalid value')
  }
}
