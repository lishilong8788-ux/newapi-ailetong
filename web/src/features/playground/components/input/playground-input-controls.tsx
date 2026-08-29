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
import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { usePromptInputAttachments } from '@/components/ai-elements/prompt-input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { getInputControlState } from '../../lib'
import { getCapability } from '../../lib/capability'
import type { ParamChipValues } from '../../lib/parameters/param-chip-values'
import type { GroupOption, ModelOption } from '../../types'
import { ModelLibrarySheet } from '../model-library/model-library-sheet'
import { ModelPriceNote } from './model-price-note'
import { ParamChipBar } from './param-chip-bar'
import { StorageNote } from './storage-note'
import { UploadChip } from './upload-chip'

/** Billing unit to the note shown after the parameter chips (i18next keys). */
const BILLING_UNIT_NOTES: Record<string, string> = {
  token: 'Billed per token',
  call: 'Billed per request',
  second: 'Billed per second',
  char: 'Billed per character',
}

type PlaygroundInputControlsProps = {
  disabled?: boolean
  /** Threaded to the narrow-screen library drawer, which hosts the group row. */
  groups: GroupOption[]
  groupValue: string
  isGenerating?: boolean
  isModelLoading?: boolean
  models: ModelOption[]
  modelValue: string
  onGroupChange: (value: string) => void
  onModelChange: (value: string) => void
  onStop?: () => void
  text: string
  tools: ReactNode
  /** Selected model; its modality decides which chips the bar shows. */
  selectedModel?: ModelOption
  paramChipValues: ParamChipValues
  onParamChipChange: (id: string, value: string) => void
}

export function PlaygroundInputControls({
  disabled,
  groups,
  groupValue,
  isGenerating,
  isModelLoading = false,
  models,
  modelValue,
  onGroupChange,
  onModelChange,
  onStop,
  text,
  tools,
  selectedModel,
  paramChipValues,
  onParamChipChange,
}: PlaygroundInputControlsProps) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  const capability = selectedModel?.modality
    ? getCapability(selectedModel.modality)
    : undefined
  const { canSubmit, shouldShowStop } = getInputControlState({
    attachmentCount: attachments.files.length,
    disabled,
    hasStopHandler: Boolean(onStop),
    isGenerating,
    models,
    text,
  })

  /**
   * One 36px circle, three states, and the outline never moves.
   *
   * Both transitions used to change the button's shape. Empty input hit
   * `disabled:bg-muted`, which faded the only primary-coloured thing in the
   * composer into a grey outline pill indistinguishable from the ghost icons
   * beside it — so the first thing a new user looks for was also the thing that
   * disappeared before they typed. Generating swapped in a differently-sized
   * secondary pill, moving the target mid-task.
   *
   * Now the fill and the footprint are constant and only the glyph swaps.
   * `opacity-40` on the disabled face keeps the shape legible as "this is where
   * send lives" while still reading as unavailable.
   *
   * Icon-only: `Send`/`Stop` as text made the button 3-4x wider in some
   * languages, and the label is carried by `aria-label` plus the tooltip, so
   * screen-reader and keyboard users lose nothing.
   */
  const renderSubmitButton = () => {
    const shared =
      'inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-all focus-visible:ring-2 focus-visible:ring-ring/50 outline-none'

    if (shouldShowStop) {
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-label={t('Stop')}
                className={cn(
                  shared,
                  'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
                onClick={onStop}
                type='button'
              />
            }
          >
            <SquareIcon className='size-3.5 fill-current' />
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Stop')}</p>
          </TooltipContent>
        </Tooltip>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={t('Send')}
              className={cn(
                shared,
                'bg-primary text-primary-foreground shadow-sm',
                canSubmit
                  ? 'hover:bg-primary/90'
                  : 'cursor-not-allowed opacity-40'
              )}
              disabled={!canSubmit}
              type='submit'
            />
          }
        >
          <ArrowUpIcon className='size-4' strokeWidth={2.5} />
        </TooltipTrigger>
        {/* The keybindings have worked since the textarea was written
            (`prompt-input.tsx` handles Enter, Shift+Enter and IME composition),
            but nothing on screen ever said so. */}
        <TooltipContent>
          <p>{t('Enter to send · Shift+Enter for a new line')}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  const billingNote = capability
    ? BILLING_UNIT_NOTES[capability.billing.unit]
    : undefined

  /*
   * One row, two clusters, and the parameter chips no longer get a row of their
   * own.
   *
   * The old shape was a `ParamChipBar` row stacked above an actions row, which
   * for chat meant one lone chip floating above three unrelated controls — it
   * read as a layout that had not finished. Merged, the left cluster becomes a
   * sentence: what I am sending (upload) -> what shape the result takes (the
   * modality's chips, none for chat) -> what it costs (billing). The group used
   * to sit in that third slot; it is now in the sidebar, above the list it
   * filters.
   *
   * `items-end` with `flex-1` on the left and `shrink-0` on the right: image and
   * video contribute three chips each and will wrap in a narrow composer, and
   * this keeps the send button pinned to the bottom-right corner instead of
   * being pushed down with them.
   */
  return (
    <div className='flex w-full items-end gap-2'>
      <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1.5'>
        {/* Below `lg` the persistent model-library sidebar is hidden, so the
            drawer is the only way to reach filtering, modality switching, the
            group row and the model guide. Hidden at `lg`+ where the sidebar
            returns. */}
        <div className='lg:hidden'>
          <ModelLibrarySheet
            models={models}
            selectedModel={modelValue}
            isLoading={isModelLoading}
            disabled={disabled}
            onSelectModel={onModelChange}
            groups={groups}
            groupValue={groupValue}
            onGroupChange={onGroupChange}
          />
        </div>

        {capability ? (
          <UploadChip upload={capability.upload} disabled={disabled} />
        ) : null}

        {capability ? (
          <ParamChipBar
            capability={capability}
            disabled={disabled}
            onChange={onParamChipChange}
            values={paramChipValues}
          />
        ) : null}

        {/* Plain text, not a chip: it is an annotation on the controls beside it
            rather than something to press, and a fourth outlined pill here would
            invite the eye to try. Hidden below `sm`, where the row has to fit a
            model name as well.

            The concrete rate replaces the old billing-unit label where one can be
            computed, and falls back to it otherwise — `ModelPriceNote` renders
            nothing for models with no catalog entry, and the unit is still worth
            saying for the non-token modalities. */}
        <ModelPriceNote
          fallback={
            billingNote ? (
              <span className='text-muted-foreground/80 hidden shrink-0 px-1 text-[11.5px] sm:inline'>
                · {t(billingNote)}
              </span>
            ) : null
          }
          groupValue={groupValue}
          selectedModel={selectedModel}
        />

        {/* Last in the left cluster, after the billing note: both are facts
            about the request rather than controls on it, and this is the less
            urgent of the two. */}
        <StorageNote />
      </div>

      <div className='flex shrink-0 items-center gap-1'>
        {tools}
        {/* Separates conversation-level actions from the primary one, so the
            destructive button never sits flush against send. */}
        <div className='bg-border/70 mx-0.5 h-4 w-px' aria-hidden='true' />
        {renderSubmitButton()}
      </div>
    </div>
  )
}
