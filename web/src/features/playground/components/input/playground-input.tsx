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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputFooter,
  PromptInputTextarea,
  type PromptInputMessage,
  type PromptInputProps,
} from '@/components/ai-elements/prompt-input'

import {
  compressImageDataUrls,
  getSubmittableInput,
  INPUT_IMAGE_ACCEPT,
  MAX_INPUT_IMAGE_BYTES,
  MAX_INPUT_IMAGES,
} from '../../lib'
import type { ParamChipValues } from '../../lib/parameters/param-chip-values'
import type { ModelOption, GroupOption } from '../../types'
import { PlaygroundInputAttachments } from './playground-input-attachments'
import { PlaygroundInputControls } from './playground-input-controls'
import { PlaygroundInputTools } from './playground-input-tools'

interface PlaygroundInputProps {
  onSubmit: (text: string, images?: string[]) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  hasMessages?: boolean
  onClearMessages?: () => void
  /** Drives the parameter chip bar's modality; absent while models load. */
  selectedModel?: ModelOption
  paramChipValues: ParamChipValues
  onParamChipChange: (id: string, value: string) => void
}

export function PlaygroundInput({
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
  hasMessages = false,
  onClearMessages,
  selectedModel,
  paramChipValues,
  onParamChipChange,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  const handleSubmit = async (message: PromptInputMessage) => {
    const submittable = getSubmittableInput(message, disabled)

    if (!submittable) return
    const images = await compressImageDataUrls(submittable.images)
    onSubmit(submittable.text, images)
    setText('')
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
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        accept={INPUT_IMAGE_ACCEPT}
        className='relative'
        maxFiles={MAX_INPUT_IMAGES}
        maxFileSize={MAX_INPUT_IMAGE_BYTES}
        multiple
        onError={handleAttachmentError}
        /*
         * One border, not two.
         *
         * This carried `border-border/70` and `ring-1 ring-foreground/5`
         * together: two near-identical hairlines 1px apart, which in light mode
         * resolved as a single smudged grey edge rather than as either a border
         * or a ring. Same failure as the model description card — an edge the eye
         * can detect but cannot focus. The border is now full strength and alone,
         * and depth comes from the shadow, which is what a shadow is for.
         *
         * Focus is a real state change (primary border plus a soft primary halo)
         * rather than a 15% shift on an already-invisible ring.
         */
        groupClassName='bg-background/95 dark:bg-background/80 border-border rounded-2xl overflow-hidden shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] transition-all duration-200 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 focus-within:shadow-[0_22px_70px_-34px_rgba(0,0,0,0.75)]'
        onSubmit={handleSubmit}
      >
        <PlaygroundInputAttachments />

        {/* 64px, down from 96px, and `max-h-[40svh]` up from the primitive's
            192px cap.

            The old floor held open a three-line box in front of a two-word
            placeholder, so the composer opened with a block of dead space in it
            — the tallest thing on the page saying the least. `field-sizing-content`
            (set by the primitive) already grows the box as you type, so the floor
            only ever needs to fit the first line; the ceiling is what matters for
            long prompts, and a viewport fraction scales better than a fixed 192px
            on tall screens.

            The placeholder names the paste/drag path. Attachments have always
            worked that way — `prompt-input.tsx` handles both — but nothing said
            so, so for most people the feature did not exist. Now the upload chip
            below says it too, and this says it at the moment of typing. */}
        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='max-h-[40svh] min-h-16 px-5 pt-4 pb-3 leading-7 md:text-base'
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('Describe your task, or paste and drag in images')}
          value={text}
        />

        {/* `bg-muted/50`, up from `/20`. Composited over the card the old tint
            was a sub-1% lightness step — the footer was not a distinct band, it
            just had a line above it. */}
        <PromptInputFooter className='border-border/60 bg-muted/50 dark:bg-muted/20 border-t px-3 py-2.5 backdrop-blur'>
          <PlaygroundInputControls
            disabled={disabled}
            groups={groups}
            groupValue={groupValue}
            isGenerating={isGenerating}
            isModelLoading={isModelLoading}
            models={models}
            modelValue={modelValue}
            onGroupChange={onGroupChange}
            onModelChange={onModelChange}
            onStop={onStop}
            text={text}
            selectedModel={selectedModel}
            paramChipValues={paramChipValues}
            onParamChipChange={onParamChipChange}
            tools={
              <PlaygroundInputTools
                disabled={disabled}
                hasMessages={hasMessages}
                onClearMessages={onClearMessages}
              />
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
