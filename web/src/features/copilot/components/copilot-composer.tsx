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
import { Paperclip, Send, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputTextarea,
  usePromptInputAttachments,
  type PromptInputMessage,
  type PromptInputProps,
} from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  compressImageDataUrls,
  INPUT_IMAGE_ACCEPT,
  MAX_INPUT_IMAGES,
  MAX_INPUT_IMAGE_BYTES,
} from '@/features/playground/lib/input/input-attachment-utils'
import { getSubmittableInput } from '@/features/playground/lib/input/input-control-utils'

export interface CopilotComposerProps {
  value: string
  onChange: (value: string) => void
  /**
   * Images arrive as compressed data URLs alongside the text.
   *
   * Compressed here rather than server-side because the raw clipboard PNG of a
   * full-screen report is several megabytes and the copilot re-sends every image
   * on every turn — the re-encode pays for itself many times over in one
   * conversation.
   */
  onSubmit: (images: string[]) => void
  onStop: () => void
  isStreaming: boolean
  disabled?: boolean
  /**
   * The model/channel picker, rendered inside the input frame.
   *
   * Passed in rather than built here, and deliberately outside `disabled`: an
   * unconfigured copilot disables sending, and the picker is exactly what fixes
   * that — disabling it too would leave no way out of the blocked state.
   */
  picker?: ReactNode
}

const TEXTAREA_ID = 'copilot-composer-input'

export function CopilotComposer(props: CopilotComposerProps) {
  const { t } = useTranslation()

  const handleSubmit = async (message: PromptInputMessage) => {
    if (props.isStreaming) return
    // Same gate the playground uses: text-or-images, not text-alone. Pasting a
    // report screenshot with no words is the shortest form of "what's wrong with
    // this".
    const submittable = getSubmittableInput(
      { files: message.files, text: props.value },
      props.disabled
    )
    if (!submittable) return
    props.onSubmit(await compressImageDataUrls(submittable.images))
  }

  const handleAttachmentError: NonNullable<PromptInputProps['onError']> = (
    error
  ) => {
    if (error.code === 'accept') {
      toast.error(t('Only image attachments are supported'))
      return
    }
    if (error.code === 'max_file_size') {
      toast.error(t('Image is too large to attach'))
      return
    }
    toast.error(
      t('You can attach up to {{limit}} images', { limit: MAX_INPUT_IMAGES })
    )
  }

  return (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor={TEXTAREA_ID} className='sr-only'>
        {t('Ask the ops copilot')}
      </Label>
      {/* `PromptInput` rather than a bare textarea: it already carries paste-to-
          attach, drag-and-drop, the file picker, the count/size limits, and the
          IME guard on Enter. This composer used to hand-roll the IME guard and
          nothing else — reimplementing the rest here would be a second place for
          the same behaviour to drift. */}
      <PromptInput
        accept={INPUT_IMAGE_ACCEPT}
        maxFiles={MAX_INPUT_IMAGES}
        maxFileSize={MAX_INPUT_IMAGE_BYTES}
        multiple
        globalDrop
        onError={handleAttachmentError}
        onSubmit={handleSubmit}
        groupClassName='bg-card focus-within:border-ring rounded-xl border transition-colors'
      >
        <CopilotComposerAttachments />

        <PromptInputTextarea
          id={TEXTAREA_ID}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          disabled={props.disabled}
          placeholder={t(
            'Ask about margin, cost, pricing or channels, or paste a screenshot...'
          )}
          className='max-h-40 min-h-11 border-0 bg-transparent px-3 py-2.5 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent'
        />

        {/* The picker sits on the same row as send, the way a chat client puts the
            model next to the thing that uses it — this is the answer to "which
            model just said that", asked at the moment of asking. */}
        <PromptInputFooter className='flex items-center justify-between gap-2 border-0 px-2 pb-2'>
          <div className='flex min-w-0 items-center gap-1'>
            <CopilotComposerAttachButton disabled={props.disabled} />
            {props.picker}
          </div>

          {props.isStreaming ? (
            <Button
              type='button'
              variant='outline'
              size='icon'
              onClick={props.onStop}
              aria-label={t('Stop generating')}
            >
              <Square aria-hidden='true' />
            </Button>
          ) : (
            <CopilotComposerSend disabled={props.disabled} text={props.value} />
          )}
        </PromptInputFooter>
      </PromptInput>

      <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px]'>
        <span>{t('Enter to send · Shift+Enter for a new line')}</span>
        {/* Not boilerplate: it splits trust precisely where it belongs. The
            figures are computed by the same code the ledger pages use, so they are
            as good as those pages; the sentence wrapped around them is the model's
            and is not. */}
        <span>
          {t(
            'Amounts and ratios come from system computation; the wording around them may be off.'
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * The visible way in to attaching a screenshot.
 *
 * Paste and drag both work without it, and neither is discoverable — the same
 * gap the playground's upload chip was added to close. Without a control that
 * says so, the feature effectively does not exist for anyone who does not think
 * to try Ctrl+V on a chat box.
 */
function CopilotComposerAttachButton(props: { disabled?: boolean }) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  const isFull = attachments.files.length >= MAX_INPUT_IMAGES

  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      disabled={props.disabled || isFull}
      onClick={() => attachments.openFileDialog()}
      aria-label={t('Attach')}
      title={
        isFull
          ? t('You can attach up to {{limit}} images', {
              limit: MAX_INPUT_IMAGES,
            })
          : t('Attach')
      }
    >
      <Paperclip aria-hidden='true' className='size-4 opacity-70' />
    </Button>
  )
}

/** The attached-image chips, absent from the layout while nothing is attached. */
function CopilotComposerAttachments() {
  const attachments = usePromptInputAttachments()

  if (attachments.files.length === 0) {
    return null
  }

  return (
    <PromptInputHeader className='border-border/60 bg-muted/20 dark:bg-muted/10 border-b px-3 py-2'>
      <PromptInputAttachments>
        {(attachment) => (
          <PromptInputAttachment data={attachment} key={attachment.id} />
        )}
      </PromptInputAttachments>
    </PromptInputHeader>
  )
}

/**
 * Send, enabled by text *or* attachments.
 *
 * A child component rather than part of the parent because the attachment count
 * lives in `PromptInput`'s context: a screenshot with no caption is a real
 * question, and a button that reads only the text would refuse to send it.
 */
function CopilotComposerSend(props: { disabled?: boolean; text: string }) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  const canSend =
    !props.disabled &&
    (props.text.trim().length > 0 || attachments.files.length > 0)

  return (
    <Button
      type='submit'
      size='icon'
      disabled={!canSend}
      aria-label={t('Send')}
    >
      <Send aria-hidden='true' />
    </Button>
  )
}
