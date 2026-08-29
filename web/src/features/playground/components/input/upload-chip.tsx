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
import { PaperclipIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { usePromptInputAttachments } from '@/components/ai-elements/prompt-input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type { UploadSpec } from '../../lib/capability'

type UploadChipProps = {
  upload: UploadSpec
  disabled?: boolean
}

/**
 * The composer's attachment entry point.
 *
 * `CHAT_CAPABILITY` has declared `upload: { kind: 'attachments', max: 10 }`
 * since the registry was written, but nothing in the UI ever offered it: images
 * could only be attached by pasting or dragging onto the textarea. Both work,
 * neither is discoverable, so for most people the feature did not exist. This
 * chip is the visible half of a path that was already wired.
 *
 * Sits first in the footer's left cluster, where the row reads as a sentence:
 * what I am sending -> how it is generated -> what it costs. That slot used to
 * hold the clear-history button, which put the one destructive action in the
 * position every other chat UI reserves for adding things.
 */
export function UploadChip({ upload, disabled }: UploadChipProps) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()

  // `voice-picker` is a different interaction entirely (pick a voice, not upload
  // a file) and `null` means the modality takes text only. Neither belongs
  // behind a paperclip.
  if (!upload || upload.kind === 'voice-picker') {
    return null
  }

  const count = attachments.files.length
  const isFull = count >= upload.max
  const label = upload.kind === 'reference-slot' ? t(upload.label) : t('Attach')

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type='button'
            disabled={disabled || isFull}
            onClick={() => attachments.openFileDialog()}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors',
              'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
              // Matches `ParamChip`'s two faces: bare until it carries a value,
              // filled once it does. An attachment count is a value.
              count > 0
                ? 'border-primary/45 bg-accent text-accent-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/60'
            )}
          />
        }
      >
        <PaperclipIcon className='size-3.5 shrink-0 opacity-70' />
        <span>{label}</span>
        {/* The count appears only once there is something to count. Showing
            `0/10` on an empty composer reads like a quota warning, and the
            ceiling is not information anyone needs before their first file. */}
        {count > 0 ? (
          <span className='tabular-nums'>
            {count}/{upload.max}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent>
        <p>
          {isFull
            ? t('You can attach up to {{limit}} images', { limit: upload.max })
            : t('Attach images, or paste and drag them in')}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
