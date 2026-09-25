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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getCopilotImageBlob } from '../api'

/**
 * The images attached to one user turn.
 *
 * Two kinds of source arrive here and both have to render: a data URL for the
 * turn just sent (already in the browser, shown without a round trip) and a
 * server-relative path for a turn read back from history. Paths are fetched as
 * blobs because the dashboard authenticates with a header and an `<img>` cannot
 * send one.
 */
export function CopilotTurnImages(props: { images: string[] }) {
  const { t } = useTranslation()
  const resolved = useCopilotImageSources(props.images)

  if (props.images.length === 0) {
    return null
  }

  return (
    <div className='flex max-w-full flex-wrap justify-end gap-2'>
      {resolved.map((entry) => (
        <img
          key={entry.key}
          src={entry.src}
          alt={t('Attached image {{index}}', { index: entry.position })}
          className='border-border/70 bg-muted/40 max-h-56 max-w-[min(100%,16rem)] rounded-xl border object-contain shadow-sm'
        />
      ))}
    </div>
  )
}

type ResolvedImage = { key: string; position: number; src: string }

function isInlineImage(source: string): boolean {
  return source.startsWith('data:') || source.startsWith('blob:')
}

/**
 * Turns stored paths into loadable sources, leaving inline ones alone.
 *
 * Object URLs are revoked when the set of sources changes or the turn unmounts.
 * Without that, scrolling a long conversation would leak one blob per screenshot
 * for as long as the tab stays open — and these are screenshots, not thumbnails.
 */
function useCopilotImageSources(images: string[]): ResolvedImage[] {
  // Joined into a string so the effect compares by content: `images` is a fresh
  // array on every render of the parent, and depending on it directly would
  // refetch every screenshot on each keystroke in the composer.
  const key = images.join('\n')
  const [fetched, setFetched] = useState<Record<string, string>>({})

  useEffect(() => {
    const sources = key.length > 0 ? key.split('\n') : []
    const remote = sources.filter((source) => !isInlineImage(source))
    if (remote.length === 0) {
      setFetched({})
      return
    }

    let active = true
    const created: string[] = []

    void Promise.all(
      remote.map(async (path) => {
        try {
          const blob = await getCopilotImageBlob(path)
          const objectUrl = URL.createObjectURL(blob)
          created.push(objectUrl)
          return [path, objectUrl] as const
        } catch {
          // A missing image renders as a broken tile rather than taking the
          // transcript down with it: the text of the conversation is what the
          // operator came back for.
          return [path, ''] as const
        }
      })
    ).then((pairs) => {
      if (!active) {
        pairs.forEach(([, url]) => url && URL.revokeObjectURL(url))
        return
      }
      setFetched(Object.fromEntries(pairs.filter(([, url]) => url !== '')))
    })

    return () => {
      active = false
      created.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [key])

  const sources = key.length > 0 ? key.split('\n') : []
  return sources.map((source, index) => ({
    key: `${index}:${source.slice(-40)}`,
    position: index + 1,
    src: isInlineImage(source) ? source : (fetched[source] ?? ''),
  }))
}
