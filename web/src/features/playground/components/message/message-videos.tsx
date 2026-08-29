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
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

type MessageVideosProps = {
  videos: string[]
  className?: string
}

/**
 * Generated videos on a message.
 *
 * Not folded into `MessageImages`: a video needs its own element with controls,
 * and putting one through an image grid renders a thumbnail nobody can play.
 *
 * `preload='metadata'` rather than `auto`: these are generated files of unknown
 * size and the user may never press play, so fetching only enough for duration
 * and the first frame is the difference between a poster and several megabytes.
 */
export function MessageVideos({ videos, className }: MessageVideosProps) {
  const { t } = useTranslation()

  if (videos.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {videos.map((src) => (
        <video
          key={src}
          className='max-h-[420px] w-full rounded-xl border bg-black/90'
          controls
          preload='metadata'
          src={src}
        >
          {/* Reached only by a browser with no <video> support at all, where the
              URL is the one useful thing left to offer. */}
          <a href={src} rel='noreferrer' target='_blank'>
            {t('Open video')}
          </a>
        </video>
      ))}
    </div>
  )
}
