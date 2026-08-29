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
import { Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type PlaygroundInputToolsProps = {
  disabled?: boolean
  hasMessages?: boolean
  onClearMessages?: () => void
}

/**
 * Composer actions that are not parameters.
 *
 * Only clearing the history lives here. An attachment menu and a web-search
 * toggle used to sit alongside it, both of which only ever raised a "feature in
 * development" toast — the menu was a dead end in front of a working path, and
 * the real one is now the `UploadChip` in the left cluster. The
 * sampling-parameter button was a second trigger for the panel the composer's
 * `Advanced settings` chip already opens, and is gone for the same reason: one
 * control, one place.
 *
 * This used to render at the head of the footer row — the leftmost control in
 * the composer, which is the slot every other chat UI gives to adding an
 * attachment. Putting the only destructive action there meant the reach for
 * "attach a file" landed on "delete everything". It now sits in the right
 * cluster, behind a divider, next to the other thing that acts on the
 * conversation as a whole.
 */
export function PlaygroundInputTools({
  disabled,
  hasMessages = false,
  onClearMessages,
}: PlaygroundInputToolsProps) {
  const { t } = useTranslation()
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  const handleClearMessages = () => {
    onClearMessages?.()
    setClearConfirmOpen(false)
    toast.success(t('Conversation cleared'))
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <PromptInputButton
              aria-label={t('Clear chat history')}
              // `size-8` against the send button's `size-9`: deliberately the
              // smaller of the two, so the pair reads as one secondary and one
              // primary rather than as two peers.
              className='text-muted-foreground hover:text-destructive hover:bg-destructive/10 size-8 rounded-full'
              disabled={disabled || !hasMessages || !onClearMessages}
              onClick={() => setClearConfirmOpen(true)}
              variant='ghost'
            >
              <Trash2Icon size={15} />
            </PromptInputButton>
          }
        />
        <TooltipContent>
          <p>{t('Clear chat history')}</p>
        </TooltipContent>
      </Tooltip>

      <ConfirmDialog
        destructive
        // Scoped to the selected model since transcripts became per-model:
        // the old copy said "all playground messages", which now overstates
        // what the button does by every other model's history.
        desc={t(
          "This model's saved messages will be removed. Other models keep their own history. This cannot be undone."
        )}
        confirmText={t('Clear')}
        handleConfirm={handleClearMessages}
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('Clear chat history?')}
      />
    </>
  )
}
