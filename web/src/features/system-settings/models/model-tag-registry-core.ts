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
import type { StatusVariant } from '@/components/status-badge'
import { INTERFACE_LANGUAGE_OPTIONS } from '@/i18n/languages'
import {
  BUILTIN_TAGS,
  TAG_COLOR_OPTIONS,
  TAG_FORBIDDEN_CHARS,
  TAG_KIND_OPTIONS,
  TAG_LIMITS,
  normalizeTagSlug,
  type TagDefinition,
  type TagKind,
} from '@/lib/model-tags'

// ---------------------------------------------------------------------------
// Editing model for `pricing_setting.tag_registry`
// ---------------------------------------------------------------------------
//
// The stored option holds operator OVERRIDES ONLY. The built-in vocabulary is
// compiled into `@/lib/model-tags` and the backend knows nothing about it, so
// this module seeds the editor with the built-ins locally and serializes only
// the rows the operator actually touched. An installation that never opened
// this page keeps sending an empty value.

export const TAG_REGISTRY_OPTION_KEY = 'pricing_setting.tag_registry'

/** `en` first: it is the fallback every other language resolves through. */
export const TAG_LABEL_LANGUAGE_OPTIONS = [
  ...INTERFACE_LANGUAGE_OPTIONS.filter((lang) => lang.code === 'en'),
  ...INTERFACE_LANGUAGE_OPTIONS.filter((lang) => lang.code !== 'en'),
]

export const FALLBACK_TAG_LANGUAGE = 'en'
export const DEFAULT_TAG_COLOR: StatusVariant = 'neutral'
export const DEFAULT_TAG_KIND: TagKind = 'capability'

export function isTagColor(value: string): value is StatusVariant {
  return (TAG_COLOR_OPTIONS as readonly string[]).includes(value)
}

export function isTagKind(value: string): value is TagKind {
  return (TAG_KIND_OPTIONS as readonly string[]).includes(value)
}

/** How a row got into the editor. Decides whether it can be renamed or deleted. */
export type TagRowOrigin = 'builtin' | 'custom'

/** Built-in values a row reverts to, and what "unchanged" is measured against. */
export type TagRowBaseline = {
  color: StatusVariant
  kind: TagKind
  labels: Record<string, string>
  aliases: string[]
}

/**
 * One editable registry row.
 *
 * `color`/`kind` are plain strings rather than the narrowed unions because the
 * raw-JSON escape hatch can carry a value the server would reject, and the
 * operator needs to see it flagged instead of silently coerced.
 */
export type TagRegistryRow = {
  id: string
  origin: TagRowOrigin
  /** True when this row must be written to the option. Built-ins start false. */
  overridden: boolean
  slug: string
  color: string
  kind: string
  labels: Record<string, string>
  aliases: string[]
  /** Built-in defaults, for reset. Absent on custom rows. */
  baseline?: TagRowBaseline
}

/** Translator for built-in `labelKey`s in one specific language. */
export type TagLabelTranslator = (language: string, key: string) => string

function sanitizeSavedLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const labels: Record<string, string> = {}
  for (const [code, label] of Object.entries(value)) {
    if (typeof label !== 'string') continue
    const trimmedCode = code.trim()
    if (!trimmedCode) continue
    labels[trimmedCode] = label
  }
  return labels
}

function sanitizeSavedAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((alias): alias is string => typeof alias === 'string')
}

/**
 * Built-in display names for seeding an override.
 *
 * Only languages whose translation actually differs from English are seeded.
 * The i18n sync tool writes an untranslated entry as the English text itself
 * (`vi.json` holds `"Hot": "Hot"`), so seeding every language would freeze that
 * placeholder into the operator's data: a colour-only edit to `hot` would
 * persist `vi: "Hot"`, and later renaming the tag to "Trending" would leave
 * five languages stuck on the old word until each was hand-edited.
 *
 * Omitting them is render-identical today — `pickRegistryLabel` falls through
 * to `en` for any language it cannot find — and keeps `en` the single field an
 * operator has to maintain. It also keeps the payload small, since the whole
 * registry rides on `/api/status` on every page load.
 *
 * What this does NOT do is preserve future translations: `resolveTag` returns
 * on a registry hit without ever reading `labelKey`, so an overridden tag is
 * detached from the i18n bundle for every language. That is inherent to
 * registry-beats-built-in and is why only touched tags are ever persisted.
 */
function builtinBaseline(
  slug: string,
  translate: TagLabelTranslator
): TagRowBaseline {
  const builtin = BUILTIN_TAGS.find((def) => def.slug === slug)
  if (!builtin) {
    return {
      color: DEFAULT_TAG_COLOR,
      kind: DEFAULT_TAG_KIND,
      labels: {},
      aliases: [],
    }
  }

  const fallback = translate(FALLBACK_TAG_LANGUAGE, builtin.labelKey).trim()
  const labels: Record<string, string> = {}
  if (fallback) labels[FALLBACK_TAG_LANGUAGE] = fallback

  for (const language of TAG_LABEL_LANGUAGE_OPTIONS) {
    if (language.code === FALLBACK_TAG_LANGUAGE) continue
    const label = translate(language.code, builtin.labelKey).trim()
    if (!label || label === fallback) continue
    labels[language.code] = label
  }

  return {
    color: builtin.color,
    kind: builtin.kind,
    labels,
    aliases: [...builtin.aliases],
  }
}

export type TagRegistryRowsResult = {
  rows: TagRegistryRow[]
  /** True when the stored value could not be read as an array of definitions. */
  parseFailed: boolean
}

/**
 * Seed the editor: every built-in tag, plus whatever the operator saved.
 *
 * A saved entry whose slug matches a built-in becomes that built-in's row with
 * `overridden` already true, so re-saving keeps it. A saved entry matching no
 * built-in becomes a custom row. Built-in rows with no saved entry carry the
 * compiled-in defaults and are deliberately NOT serialized.
 *
 * Saved labels are used verbatim and never merged with the built-in defaults:
 * a stored entry is the operator's complete answer for that tag, and folding
 * defaults in would silently rewrite their data on the next save.
 */
export function buildTagRegistryRows(
  savedValue: string | undefined,
  translate: TagLabelTranslator
): TagRegistryRowsResult {
  const raw = (savedValue ?? '').trim()
  let saved: TagDefinition[] = []
  let parseFailed = false

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        saved = parsed as TagDefinition[]
      } else {
        parseFailed = true
      }
    } catch {
      parseFailed = true
    }
  }

  const savedBySlug = new Map<string, TagDefinition>()
  const savedOrder: TagDefinition[] = []
  for (const entry of saved) {
    if (!entry || typeof entry !== 'object') continue
    savedOrder.push(entry)
    const slug = normalizeTagSlug(String(entry.slug ?? ''))
    if (!slug || savedBySlug.has(slug)) continue
    savedBySlug.set(slug, entry)
  }

  const rows: TagRegistryRow[] = []
  // Tracked by entry identity, not by slug: a stored value carrying the same
  // slug twice must survive into two rows so validation can report it, rather
  // than being quietly collapsed into one.
  const consumed = new Set<TagDefinition>()

  for (const builtin of BUILTIN_TAGS) {
    const baseline = builtinBaseline(builtin.slug, translate)
    const entry = savedBySlug.get(builtin.slug)
    if (entry) consumed.add(entry)

    rows.push({
      id: `builtin:${builtin.slug}`,
      origin: 'builtin',
      overridden: Boolean(entry),
      slug: builtin.slug,
      color: entry ? String(entry.color ?? '') : baseline.color,
      kind: entry ? String(entry.kind ?? DEFAULT_TAG_KIND) : baseline.kind,
      labels: entry ? sanitizeSavedLabels(entry.labels) : { ...baseline.labels },
      aliases: entry ? sanitizeSavedAliases(entry.aliases) : [...baseline.aliases],
      baseline,
    })
  }

  let customIndex = 0
  for (const entry of savedOrder) {
    if (consumed.has(entry)) continue
    rows.push({
      id: `custom:${customIndex++}`,
      origin: 'custom',
      overridden: true,
      slug: String(entry.slug ?? ''),
      color: String(entry.color ?? ''),
      kind: String(entry.kind ?? DEFAULT_TAG_KIND),
      labels: sanitizeSavedLabels(entry.labels),
      aliases: sanitizeSavedAliases(entry.aliases),
    })
  }

  return { rows, parseFailed }
}

export type TagRowPatch = Partial<
  Pick<TagRegistryRow, 'slug' | 'color' | 'kind' | 'labels' | 'aliases'>
>

/**
 * Apply an edit to one row.
 *
 * Every edit marks the row `overridden`, which is what promotes a built-in from
 * "compiled-in default, not persisted" to "operator override, persisted". A
 * built-in's slug is fixed: renaming it would orphan the override, since the
 * registry matches the built-in vocabulary by slug.
 */
export function applyTagRowEdit(
  rows: TagRegistryRow[],
  id: string,
  patch: TagRowPatch
): TagRegistryRow[] {
  return rows.map((row) => {
    if (row.id !== id) return row
    const next: TagRegistryRow = { ...row, ...patch, overridden: true }
    if (row.origin === 'builtin') next.slug = row.slug
    return next
  })
}

/** Revert a built-in row to its compiled-in defaults, dropping the override. */
export function resetTagRow(
  rows: TagRegistryRow[],
  id: string
): TagRegistryRow[] {
  return rows.map((row) => {
    if (row.id !== id || !row.baseline) return row
    return {
      ...row,
      overridden: false,
      color: row.baseline.color,
      kind: row.baseline.kind,
      labels: { ...row.baseline.labels },
      aliases: [...row.baseline.aliases],
    }
  })
}

/** Drop a custom row. Built-in rows are reset instead, never removed. */
export function removeTagRow(
  rows: TagRegistryRow[],
  id: string
): TagRegistryRow[] {
  return rows.filter((row) => row.id !== id || row.origin === 'builtin')
}

export function addCustomTagRow(
  rows: TagRegistryRow[],
  nextId: string
): TagRegistryRow[] {
  return [
    ...rows,
    {
      id: nextId,
      origin: 'custom',
      overridden: true,
      slug: '',
      color: DEFAULT_TAG_COLOR,
      kind: DEFAULT_TAG_KIND,
      labels: {},
      aliases: [],
    },
  ]
}

/** Rows that must be written to the option: all custom rows, edited built-ins. */
export function selectPersistedTagRows(
  rows: readonly TagRegistryRow[]
): TagRegistryRow[] {
  return rows.filter((row) => row.overridden)
}

/**
 * One row as the backend's `TagDefinition`.
 *
 * `kind` is always written even though the server treats an empty kind as
 * `capability`: the editor always shows a concrete choice, and a written value
 * survives a future change to that default.
 */
export function toTagDefinition(row: TagRegistryRow): TagDefinition {
  const labels: Record<string, string> = {}
  for (const [code, label] of Object.entries(row.labels)) {
    const trimmed = label.trim()
    if (trimmed) labels[code] = trimmed
  }

  const aliases: string[] = []
  const seenAliases = new Set<string>()
  for (const alias of row.aliases) {
    const trimmed = alias.trim()
    if (!trimmed) continue
    const normalized = normalizeTagSlug(trimmed)
    if (!normalized || seenAliases.has(normalized)) continue
    seenAliases.add(normalized)
    aliases.push(trimmed)
  }

  const definition: TagDefinition = {
    slug: normalizeTagSlug(row.slug),
    // Validation gates the save, so an out-of-range colour or kind can only
    // reach here while the operator is still editing (dirty-state comparison
    // and the live preview both read this).
    color: row.color as StatusVariant,
    kind: row.kind as TagKind,
  }
  if (Object.keys(labels).length > 0) definition.labels = labels
  if (aliases.length > 0) definition.aliases = aliases
  return definition
}

/**
 * The option value for these rows: `''` when nothing is overridden.
 *
 * Empty string rather than `[]` keeps an untouched installation byte-identical
 * to how it shipped, and is what the backend documents as "no overrides".
 */
export function serializeTagRegistryRows(rows: readonly TagRegistryRow[]): string {
  const persisted = selectPersistedTagRows(rows)
  if (persisted.length === 0) return ''
  return JSON.stringify(persisted.map(toTagDefinition))
}

/** Why a row would be rejected. Mirrors `pricing_setting.ValidateTagRegistry`. */
export type TagRegistryIssueCode =
  | 'too-many-entries'
  | 'slug-required'
  | 'slug-too-long'
  | 'slug-forbidden-char'
  | 'slug-duplicate'
  | 'unknown-color'
  | 'unknown-kind'
  | 'label-required'
  | 'label-too-long'
  | 'too-many-aliases'
  | 'alias-too-long'
  | 'alias-forbidden-char'
  | 'alias-conflicts-slug'
  | 'alias-duplicate'

export type TagRegistryIssue = {
  code: TagRegistryIssueCode
  /** Absent for whole-registry issues such as the entry cap. */
  rowId?: string
  /** Which control to flag. `labels` issues carry the language code. */
  field?: 'slug' | 'color' | 'kind' | 'aliases' | 'label'
  language?: string
  params?: Record<string, string | number>
}

function runeLength(value: string): number {
  return [...value].length
}

function findForbiddenChar(value: string): string | undefined {
  return TAG_FORBIDDEN_CHARS.find((char) => value.includes(char))
}

/**
 * Validate what would actually be sent.
 *
 * Only overridden rows are checked, because only those are serialized — an
 * untouched built-in can never make a save fail. The rules deliberately mirror
 * the Go validator so the operator gets an inline message instead of a 400, but
 * the server remains the authority.
 */
export function validateTagRegistryRows(
  rows: readonly TagRegistryRow[]
): TagRegistryIssue[] {
  const persisted = selectPersistedTagRows(rows)
  const issues: TagRegistryIssue[] = []

  if (persisted.length > TAG_LIMITS.maxRegistryEntries) {
    issues.push({
      code: 'too-many-entries',
      params: {
        max: TAG_LIMITS.maxRegistryEntries,
        count: persisted.length,
      },
    })
  }

  const slugOwner = new Map<string, string>()

  for (const row of persisted) {
    const slug = normalizeTagSlug(row.slug)

    if (!slug) {
      issues.push({ code: 'slug-required', rowId: row.id, field: 'slug' })
    } else {
      if (runeLength(slug) > TAG_LIMITS.maxSlugLength) {
        issues.push({
          code: 'slug-too-long',
          rowId: row.id,
          field: 'slug',
          params: { max: TAG_LIMITS.maxSlugLength },
        })
      }
      const forbidden = findForbiddenChar(slug)
      if (forbidden) {
        issues.push({
          code: 'slug-forbidden-char',
          rowId: row.id,
          field: 'slug',
          params: { char: forbidden },
        })
      }
      if (slugOwner.has(slug)) {
        issues.push({
          code: 'slug-duplicate',
          rowId: row.id,
          field: 'slug',
          params: { slug },
        })
      } else {
        slugOwner.set(slug, row.id)
      }
    }

    if (!isTagColor(row.color)) {
      issues.push({
        code: 'unknown-color',
        rowId: row.id,
        field: 'color',
        params: { color: row.color },
      })
    }
    if (!isTagKind(row.kind)) {
      issues.push({
        code: 'unknown-kind',
        rowId: row.id,
        field: 'kind',
        params: { kind: row.kind },
      })
    }

    // `en` is the language every other one falls back to. Without it a tag
    // renders as its raw stored text, which is exactly the regression this
    // feature exists to remove.
    if (!(row.labels[FALLBACK_TAG_LANGUAGE] ?? '').trim()) {
      issues.push({
        code: 'label-required',
        rowId: row.id,
        field: 'label',
        language: FALLBACK_TAG_LANGUAGE,
      })
    }
    for (const [code, label] of Object.entries(row.labels)) {
      if (runeLength(label.trim()) > TAG_LIMITS.maxLabelLength) {
        issues.push({
          code: 'label-too-long',
          rowId: row.id,
          field: 'label',
          language: code,
          params: { max: TAG_LIMITS.maxLabelLength },
        })
      }
    }

    const aliases = row.aliases.map((alias) => alias.trim()).filter(Boolean)
    if (aliases.length > TAG_LIMITS.maxAliases) {
      issues.push({
        code: 'too-many-aliases',
        rowId: row.id,
        field: 'aliases',
        params: { max: TAG_LIMITS.maxAliases },
      })
    }
    for (const alias of aliases) {
      const normalized = normalizeTagSlug(alias)
      if (normalized && runeLength(normalized) > TAG_LIMITS.maxSlugLength) {
        issues.push({
          code: 'alias-too-long',
          rowId: row.id,
          field: 'aliases',
          params: { alias, max: TAG_LIMITS.maxSlugLength },
        })
      }
      const forbidden = findForbiddenChar(alias)
      if (forbidden) {
        issues.push({
          code: 'alias-forbidden-char',
          rowId: row.id,
          field: 'aliases',
          params: { alias, char: forbidden },
        })
      }
    }
  }

  // Second pass, matching the server: an alias that also names another entry's
  // slug — or another entry's alias — makes resolution order-dependent.
  const aliasOwner = new Map<string, string>()
  for (const row of persisted) {
    const seenInRow = new Set<string>()
    for (const alias of row.aliases) {
      const normalized = normalizeTagSlug(alias)
      if (!normalized || seenInRow.has(normalized)) continue
      seenInRow.add(normalized)

      const slugRowId = slugOwner.get(normalized)
      if (slugRowId && slugRowId !== row.id) {
        issues.push({
          code: 'alias-conflicts-slug',
          rowId: row.id,
          field: 'aliases',
          params: { alias },
        })
        continue
      }
      const aliasRowId = aliasOwner.get(normalized)
      if (aliasRowId && aliasRowId !== row.id) {
        issues.push({
          code: 'alias-duplicate',
          rowId: row.id,
          field: 'aliases',
          params: { alias },
        })
        continue
      }
      aliasOwner.set(normalized, row.id)
    }
  }

  return issues
}

/** Issues grouped by row, for rendering them next to the control that failed. */
export function groupTagRegistryIssues(
  issues: readonly TagRegistryIssue[]
): Map<string, TagRegistryIssue[]> {
  const grouped = new Map<string, TagRegistryIssue[]>()
  for (const issue of issues) {
    if (!issue.rowId) continue
    const existing = grouped.get(issue.rowId)
    if (existing) {
      existing.push(issue)
      continue
    }
    grouped.set(issue.rowId, [issue])
  }
  return grouped
}

