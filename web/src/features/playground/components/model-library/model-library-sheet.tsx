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
import { LayoutGridIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { GroupOption, ModelOption } from '../../types'
import { ModelLibrary } from './model-library'

type ModelLibrarySheetProps = {
  models: ModelOption[]
  selectedModel: string
  isLoading: boolean
  disabled?: boolean
  onSelectModel: (modelName: string) => void
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
}

/**
 * The model library as a drawer, for widths below `lg` where the persistent
 * sidebar is hidden. Without this, filtering, modality switching and the model
 * guide are all unreachable on a narrow screen — the composer's model dropdown
 * only lets you pick from a flat list.
 *
 * Opens from the left so it animates in from the same edge the desktop sidebar
 * lives on, and closes as soon as a model is picked: on a small screen the point
 * is to choose and get back to the conversation, not to linger in the list.
 */
export function ModelLibrarySheet({
  models,
  selectedModel,
  isLoading,
  disabled,
  onSelectModel,
  groups,
  groupValue,
  onGroupChange,
}: ModelLibrarySheetProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const activeLabel = models.find(
    (model) => model.value === selectedModel
  )?.label

  /**
   * Carries the model name, not just a grid glyph.
   *
   * Below `lg` the sidebar is hidden, so this button was the only trace of the
   * library on screen — and it named nothing. That left the one question a
   * composer must always answer unanswered on small screens: who am I talking
   * to? The name is the label; the icon stays as the affordance that this opens
   * a picker.
   *
   * `max-w-[9rem]` with `truncate` because model ids here are routinely
   * path-shaped (`@cf/deepseek-ai/deepseek-math-7b-instruct`) and would
   * otherwise push the whole footer row out of the composer.
   */
  const trigger = (
    <PromptInputButton
      aria-label={t('Model library')}
      className='text-muted-foreground hover:text-foreground hover:bg-muted/70 max-w-[9rem] font-medium'
      disabled={disabled}
      variant='ghost'
    >
      <LayoutGridIcon className='shrink-0' size={16} />
      {activeLabel ? (
        <span className='truncate text-[13px]'>{activeLabel}</span>
      ) : null}
    </PromptInputButton>
  )

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<SheetTrigger render={trigger} />} />
        <TooltipContent>
          <p>{t('Model library')}</p>
        </TooltipContent>
      </Tooltip>

      <SheetContent
        className='flex w-[86vw] max-w-[20rem] flex-col gap-0 p-0'
        showCloseButton={false}
        side='left'
      >
        {/* `ModelLibrary` renders its own visible title, so the required dialog
            title is kept for screen readers only rather than drawn twice. */}
        <SheetTitle className='sr-only'>{t('Model library')}</SheetTitle>

        <div className='min-h-0 flex-1'>
          <ModelLibrary
            models={models}
            selectedModel={selectedModel}
            isLoading={isLoading}
            onSelectModel={(value) => {
              onSelectModel(value)
              setOpen(false)
            }}
            groups={groups}
            groupValue={groupValue}
            onGroupChange={onGroupChange}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
