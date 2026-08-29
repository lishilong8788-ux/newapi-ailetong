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
import type { ModelOption } from '../../types'
import { getAttachmentImageUrls } from './input-attachment-utils'

type InputControlStateOptions = {
  attachmentCount?: number
  disabled?: boolean
  hasStopHandler: boolean
  isGenerating?: boolean
  models: ModelOption[]
  text: string
}

type InputControlState = {
  canSubmit: boolean
  shouldShowStop: boolean
}

type SubmittableInputMessage = {
  text?: string | null
  files?: { mediaType?: string; url?: string }[]
}

export type SubmittableInput = {
  images: string[]
  text: string
}

/**
 * An image-only message is submittable, so the text alone cannot gate sending.
 */
export function getSubmittableInput(
  message: SubmittableInputMessage,
  disabled?: boolean
): SubmittableInput | null {
  if (disabled) {
    return null
  }

  const text = message.text ?? ''
  const images = getAttachmentImageUrls(message.files)

  if (!text.trim() && images.length === 0) {
    return null
  }

  return { images, text }
}

/**
 * `isSelectorDisabled` used to live here for the composer's group selector. The
 * group moved to the model library sidebar, where it derives its own disabled
 * state from the list's loading flag, so both it and the `groups` input are
 * gone rather than left as a field nobody reads.
 */
export function getInputControlState({
  attachmentCount = 0,
  disabled,
  hasStopHandler,
  isGenerating,
  models,
  text,
}: InputControlStateOptions): InputControlState {
  const hasModels = models.length > 0
  const hasContent = text.trim().length > 0 || attachmentCount > 0

  return {
    canSubmit: !disabled && hasModels && hasContent,
    shouldShowStop: Boolean(isGenerating && hasStopHandler),
  }
}
