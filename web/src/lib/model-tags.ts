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
import { stringToColor } from '@/lib/colors'

// ----------------------------------------------------------------------------
// Model operational tags — single source of truth
// ----------------------------------------------------------------------------
//
// Tags live in the `models.tags` column as one comma-separated string, typed by
// an operator in the model editor and shown on the public catalog. This module
// owns every rule about them: how the string splits, what a tag's canonical
// form is, and how a tag resolves to a colour, a category and a display name.
//
// It exists because those rules used to be duplicated and disagreed. The admin
// table split on `,` while the catalog split on `/[,;|\s]+/`, so `long context`
// was one tag to whoever typed it and two grey ones to every visitor. Colour
// was a lookup table on the catalog and a hash of the tag text in the admin
// table, so the same tag showed in two colours depending on the page.

/** What a tag asserts about a model. Drives ordering and emphasis. */
export type TagKind = 'promo' | 'capability' | 'lifecycle'

/** One entry of the tag vocabulary. Mirrors Go `pricing_setting.TagDefinition`. */
export interface TagDefinition {
  slug: string
  color: StatusVariant
  kind?: TagKind
  /** Language code (`en`, `zhCN`, `zhTW`, ...) to display name. */
  labels?: Record<string, string>
  /** Extra spellings resolving to this slug. */
  aliases?: string[]
}

/** A tag resolved for rendering. */
export interface ResolvedTag {
  /** Raw text as stored, for filter round-tripping. */
  raw: string
  /** Canonical identifier. */
  slug: string
  label: string
  variant: StatusVariant
  kind: TagKind
  /** False when neither the registry nor the built-ins knew this tag. */
  known: boolean
}

/** Colours the badge renders. Mirrors Go `pricing_setting.validTagColors`. */
export const TAG_COLOR_OPTIONS: readonly StatusVariant[] = [
  'success',
  'warning',
  'danger',
  'info',
  'neutral',
  'purple',
  'amber',
  'blue',
  'cyan',
  'green',
  'grey',
  'indigo',
  'light-blue',
  'light-green',
  'lime',
  'orange',
  'pink',
  'red',
  'teal',
  'violet',
  'yellow',
] as const

export const TAG_KIND_OPTIONS: readonly TagKind[] = [
  'promo',
  'capability',
  'lifecycle',
] as const

/** Limits mirrored from Go so the editor rejects before the request. */
export const TAG_LIMITS = {
  maxRegistryEntries: 64,
  maxSlugLength: 32,
  maxLabelLength: 32,
  maxAliases: 8,
  /** Cap on tags attached to one model. Card shows 3, details shows all. */
  maxTagsPerModel: 12,
} as const

/** Characters that cannot appear in a tag: `,` is the storage separator, and
 *  `;`/`|` were accepted as separators by the old catalog parser. */
export const TAG_FORBIDDEN_CHARS = [',', ';', '|'] as const

/**
 * Canonical form of a tag: trimmed, lowercased, whitespace and `_` collapsed to
 * `-`. Mirrors Go `pricing_setting.NormalizeTagSlug`.
 *
 * This is what lets the pre-existing `long context` rows resolve against the
 * `long-context` vocabulary entry with no data migration — both normalize to the
 * same slug — and what makes `Hot` and `hot` one tag instead of two.
 */
export function normalizeTagSlug(tag: string): string {
  const trimmed = tag.trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed
    .replaceAll(/[\s_-]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

/**
 * Split the stored `models.tags` string into display values.
 *
 * Comma is the only separator, because comma is the only thing the writer ever
 * emits (`formatTagList` joins with `,`). The catalog used to also split on
 * `;`, `|` and whitespace — parsing a format nothing produces — which is what
 * turned one `long context` tag into two unstyled fragments. Tags may contain
 * spaces; `normalizeTagSlug` handles matching them to hyphenated slugs.
 */
export function parseTagList(tags?: string): string[] {
  if (!tags) return []
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

/** Join tags for storage. Inverse of `parseTagList`. */
export function formatTagList(tags: string[]): string {
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(',')
}

/**
 * Built-in tag vocabulary.
 *
 * Compiled in rather than fetched so the catalog paints correct colours on
 * first render, before /api/status resolves. Operator entries from the registry
 * override an entry here by slug; anything not listed here and not in the
 * registry falls back to a hashed colour.
 *
 * `labelKey` is an explicit i18n key, never the tag text itself: i18next's
 * default `keySeparator` is `.`, so a tag like `gpt-4.5` used as a key would be
 * read as a nested path.
 */
export interface BuiltinTagDefinition {
  slug: string
  color: StatusVariant
  kind: TagKind
  labelKey: string
  aliases: string[]
}

export const BUILTIN_TAGS: readonly BuiltinTagDefinition[] = [
  // Promotion / attention
  { slug: 'hot', color: 'red', kind: 'promo', labelKey: 'Hot', aliases: ['热门', 'popular'] },
  { slug: 'recommended', color: 'orange', kind: 'promo', labelKey: 'Recommended', aliases: ['推荐'] },
  { slug: 'new', color: 'success', kind: 'promo', labelKey: 'New', aliases: ['新', '新品'] },
  { slug: 'limited-time', color: 'pink', kind: 'promo', labelKey: 'Limited time', aliases: ['限时'] },
  // Key is "Free of charge", not "Free": the existing "Free" key means free disk
  // space in the system-info panel and is translated "可用", which would label
  // this tag "available" rather than "no cost". The English value is still the
  // short "Free" that fits a pill.
  { slug: 'free', color: 'success', kind: 'promo', labelKey: 'Free of charge', aliases: ['免费'] },
  // Capability
  { slug: 'reasoning', color: 'violet', kind: 'capability', labelKey: 'Reasoning', aliases: ['推理'] },
  { slug: 'vision', color: 'cyan', kind: 'capability', labelKey: 'Vision', aliases: ['视觉'] },
  { slug: 'multimodal', color: 'cyan', kind: 'capability', labelKey: 'Multimodal', aliases: ['多模态'] },
  { slug: 'long-context', color: 'blue', kind: 'capability', labelKey: 'Long context', aliases: ['长文本', 'long context'] },
  { slug: 'web-search', color: 'teal', kind: 'capability', labelKey: 'Web search', aliases: ['联网'] },
  // Lifecycle
  { slug: 'beta', color: 'warning', kind: 'lifecycle', labelKey: 'Beta', aliases: ['测试'] },
  { slug: 'experimental', color: 'warning', kind: 'lifecycle', labelKey: 'Experimental', aliases: ['实验性'] },
  { slug: 'deprecated', color: 'danger', kind: 'lifecycle', labelKey: 'Deprecated', aliases: ['即将下线', '已下线'] },
] as const

/** slug-or-alias -> built-in entry. */
const BUILTIN_BY_KEY: Map<string, BuiltinTagDefinition> = (() => {
  const map = new Map<string, BuiltinTagDefinition>()
  for (const def of BUILTIN_TAGS) {
    map.set(def.slug, def)
    for (const alias of def.aliases) {
      const key = normalizeTagSlug(alias)
      if (key && !map.has(key)) map.set(key, def)
    }
  }
  return map
})()

/**
 * A registry entry merged onto the built-in of the same slug.
 *
 * An override is an OVERLAY, not a replacement. Treating it as a replacement
 * produced two bugs that both look like data corruption to an operator:
 *
 *  - Aliases split the tag. An operator who recolours `hot` without retyping its
 *    alias list left `热门` resolving to the built-in, so the same logical tag
 *    painted two different colours depending on which spelling a model carried.
 *  - The label detached from i18n. On a registry hit `labelKey` was never read,
 *    so a colour-only override fell through to the raw stored text and the tag
 *    stopped translating.
 *
 * Both are fixed by inheriting `aliases` and `labelKey` from the built-in for
 * anything the override does not itself specify.
 */
interface MergedTagDefinition {
  slug: string
  color: StatusVariant
  kind: TagKind
  labels?: Record<string, string>
  /** Built-in i18n key, kept so an override with no label still translates. */
  labelKey?: string
}

/** Registry lookup, rebuilt only when the registry array identity changes. */
let registryCacheSource: readonly TagDefinition[] | null = null
let registryCacheMap = new Map<string, MergedTagDefinition>()

function registryLookup(
  registry: readonly TagDefinition[]
): Map<string, MergedTagDefinition> {
  if (registryCacheSource === registry) return registryCacheMap

  const map = new Map<string, MergedTagDefinition>()
  for (const def of registry) {
    const slug = normalizeTagSlug(def.slug)
    if (!slug) continue

    const builtin = BUILTIN_BY_KEY.get(slug)
    const merged: MergedTagDefinition = {
      slug,
      color: def.color,
      kind: def.kind ?? builtin?.kind ?? 'capability',
      labels: def.labels,
      labelKey: builtin?.labelKey,
    }

    map.set(slug, merged)

    // The override's own aliases win, then the built-in's are inherited. Without
    // the inherited pass, overriding `hot` would orphan `热门`.
    const aliasSources = [def.aliases ?? [], builtin?.aliases ?? []]
    for (const aliases of aliasSources) {
      for (const alias of aliases) {
        const key = normalizeTagSlug(alias)
        if (key && !map.has(key)) map.set(key, merged)
      }
    }
  }

  registryCacheSource = registry
  registryCacheMap = map
  return map
}

/**
 * Pick a label out of a registry entry's per-language map.
 *
 * Interface codes are `zhCN`/`zhTW`, but an operator editing JSON by hand may
 * well write `zh` or `zh-CN`, so lookup is lenient before giving up on `en`.
 */
function pickRegistryLabel(
  labels: Record<string, string> | undefined,
  language: string
): string | undefined {
  if (!labels) return undefined
  const candidates = [language]
  if (language === 'zhCN') candidates.push('zh', 'zh-CN', 'zh-Hans')
  if (language === 'zhTW') candidates.push('zh-TW', 'zh-Hant', 'zh')
  const base = language.split('-')[0]
  if (base && base !== language) candidates.push(base)
  candidates.push('en')

  for (const code of candidates) {
    const label = labels[code]?.trim()
    if (label) return label
  }
  return undefined
}

export interface ResolveTagOptions {
  /** Operator overrides, from `/api/status`. */
  registry?: readonly TagDefinition[]
  /** Translator for built-in label keys. */
  t?: (key: string) => string
  /** Current interface language (`i18n.language`). */
  language?: string
}

/**
 * Resolve one raw tag to colour, category and display name.
 *
 * Order: operator registry, then built-in vocabulary, then a hashed colour.
 *
 * The hash is a last resort only. `stringToColor` is a sum of char codes mod a
 * 15-colour palette, which puts `免费` on red and `实验性` on green — actively
 * wrong signals. It beats rendering every unknown tag identical grey, which is
 * what the filter rail used to show, but a tag whose colour matters must be in
 * the vocabulary or the registry.
 */
export function resolveTag(
  raw: string,
  options: ResolveTagOptions = {}
): ResolvedTag {
  const slug = normalizeTagSlug(raw)
  const trimmed = raw.trim()

  const fromRegistry = options.registry
    ? registryLookup(options.registry).get(slug)
    : undefined
  if (fromRegistry) {
    // Label precedence: the operator's own per-language name, then the built-in's
    // translated label, then the raw stored text. The middle step is what keeps a
    // colour-only override translating — without it, recolouring `hot` silently
    // replaced every locale's word with whatever string the model happened to
    // carry in its tags column.
    const label =
      pickRegistryLabel(fromRegistry.labels, options.language ?? 'en') ??
      (fromRegistry.labelKey && options.t
        ? options.t(fromRegistry.labelKey)
        : undefined) ??
      trimmed
    return {
      raw: trimmed,
      slug: fromRegistry.slug || slug,
      label,
      variant: fromRegistry.color,
      kind: fromRegistry.kind,
      known: true,
    }
  }

  const builtin = BUILTIN_BY_KEY.get(slug)
  if (builtin) {
    return {
      raw: trimmed,
      slug: builtin.slug,
      label: options.t ? options.t(builtin.labelKey) : builtin.labelKey,
      variant: builtin.color,
      kind: builtin.kind,
      known: true,
    }
  }

  return {
    raw: trimmed,
    slug,
    label: trimmed,
    variant: stringToColor(slug || trimmed) as StatusVariant,
    kind: 'capability',
    known: false,
  }
}

/** Resolve a whole stored tag string, de-duplicated by slug. */
export function resolveTagList(
  tags: string | undefined,
  options: ResolveTagOptions = {}
): ResolvedTag[] {
  const seen = new Set<string>()
  const resolved: ResolvedTag[] = []
  for (const raw of parseTagList(tags)) {
    const tag = resolveTag(raw, options)
    const key = tag.slug || tag.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push(tag)
  }
  return resolved
}

/** Promo tags first, then the rest, order otherwise preserved. Promo-ness now
 *  comes from the vocabulary, so it is configurable rather than a hardcoded set. */
export function sortTagsByProminence(tags: ResolvedTag[]): ResolvedTag[] {
  return [
    ...tags.filter((tag) => tag.kind === 'promo'),
    ...tags.filter((tag) => tag.kind !== 'promo'),
  ]
}

/** Why a tag was rejected. Callers map these to i18n messages. */
export type TagRejection =
  | { reason: 'empty' }
  | { reason: 'forbidden-char'; char: string }
  | { reason: 'too-long'; max: number }
  | { reason: 'duplicate' }
  | { reason: 'too-many'; max: number }

/**
 * Validate one tag about to be added to a model.
 *
 * De-duplication compares normalized slugs, not exact strings: `Hot` and `hot`
 * are the same tag, and accepting both produced two identical-looking pills on
 * the card while the filter rail — which dedupes case-insensitively — listed
 * only one.
 */
export function validateTagInput(
  candidate: string,
  existing: readonly string[]
): TagRejection | null {
  const trimmed = candidate.trim()
  if (!trimmed) return { reason: 'empty' }

  for (const char of TAG_FORBIDDEN_CHARS) {
    if (trimmed.includes(char)) return { reason: 'forbidden-char', char }
  }
  if ([...trimmed].length > TAG_LIMITS.maxSlugLength) {
    return { reason: 'too-long', max: TAG_LIMITS.maxSlugLength }
  }

  const slug = normalizeTagSlug(trimmed)
  if (!slug) return { reason: 'empty' }
  if (existing.some((tag) => normalizeTagSlug(tag) === slug)) {
    return { reason: 'duplicate' }
  }
  if (existing.length >= TAG_LIMITS.maxTagsPerModel) {
    return { reason: 'too-many', max: TAG_LIMITS.maxTagsPerModel }
  }
  return null
}
