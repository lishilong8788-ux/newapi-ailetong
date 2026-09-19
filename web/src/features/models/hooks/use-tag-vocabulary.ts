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
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useSyncExternalStore } from 'react'

import { BUILTIN_TAGS, normalizeTagSlug, parseTagList } from '@/lib/model-tags'

import { modelsQueryKeys } from '../lib/query-keys'
import type { GetModelsResponse } from '../types'

/**
 * Tag slugs an operator can pick from, offered as suggestions in the editors.
 *
 * Without this there is no way to see what already exists, so operators invent
 * near-duplicates — `long ctx` next to `long-context`, `hot` next to `热门` —
 * and the catalog ends up with a vocabulary nobody chose.
 *
 * Two sources, de-duplicated by slug: the built-in vocabulary, which is always
 * offered because those are the tags that carry a designed colour, and tags
 * already on models. The second comes out of the react-query cache the models
 * table already fills, so this adds no request; a page never visited simply
 * contributes nothing.
 */
export function useTagVocabulary(): string[] {
  const queryClient = useQueryClient()
  const cache = queryClient.getQueryCache()
  const snapshot = useRef<string[]>([])

  const subscribe = useCallback(
    (onChange: () => void) => cache.subscribe(onChange),
    [cache]
  )

  const getSnapshot = useCallback(() => {
    const seen = new Set<string>()
    const tags: string[] = []

    const push = (tag: string) => {
      const slug = normalizeTagSlug(tag)
      if (!slug || seen.has(slug)) return
      seen.add(slug)
      tags.push(tag)
    }

    for (const def of BUILTIN_TAGS) push(def.slug)

    const cached = queryClient.getQueriesData<GetModelsResponse>({
      queryKey: modelsQueryKeys.lists(),
    })
    for (const [, response] of cached) {
      for (const model of response?.data?.items ?? []) {
        for (const tag of parseTagList(model.tags)) push(tag)
      }
    }

    // `useSyncExternalStore` compares snapshots by identity and the cache
    // notifies on every fetch transition, so an unchanged vocabulary has to keep
    // returning the same array or this re-renders in a loop.
    const previous = snapshot.current
    if (
      previous.length === tags.length &&
      previous.every((tag, index) => tag === tags[index])
    ) {
      return previous
    }
    snapshot.current = tags
    return tags
  }, [queryClient])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
