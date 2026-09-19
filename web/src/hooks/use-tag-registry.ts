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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import type { ResolveTagOptions, TagDefinition } from '@/lib/model-tags'

/**
 * Operator tag overrides plus everything `resolveTag` needs to render a tag.
 *
 * Returns a stable object so the memoized lookup map inside `model-tags` is not
 * rebuilt on every render, and so components taking these as props do not
 * re-render for an unchanged registry.
 *
 * The registry rides on `/api/status`, which is cached and shared with the route
 * guards, so reading it here costs no extra request. An installation that never
 * opened the tag editor gets `undefined` and falls through to the built-in
 * vocabulary compiled into `@/lib/model-tags`.
 */
export function useTagRegistry(): ResolveTagOptions {
  const { status } = useStatus()
  const { t, i18n } = useTranslation()

  const registry = status?.model_tag_registry as TagDefinition[] | undefined
  const language = i18n.language

  return useMemo(
    () => ({
      registry: registry && registry.length > 0 ? registry : undefined,
      t,
      language,
    }),
    [registry, t, language]
  )
}
