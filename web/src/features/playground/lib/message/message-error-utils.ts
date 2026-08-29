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
import { MESSAGE_STATUS } from '../../constants'
import type { Message } from '../../types'
import { getMessageContent } from './message-utils'

export const MODEL_PRICING_SETTINGS_PATH =
  '/system-settings/billing/model-pricing'

export const MODEL_PRICE_ERROR_CODE = 'model_price_error'
export const FALLBACK_ERROR_CONTENT = 'An unknown error occurred'

/**
 * Written explanations for the error codes a playground request can produce.
 *
 * Without this, the message body was the prefix `Request error occurred:`
 * followed by whatever the relay returned — for a missing channel that is a
 * sentence of English, a duplicated Chinese translation and a request id, none
 * of which tells the reader what to do. The raw text is still shown underneath
 * as `detail`, because request ids matter when asking an administrator.
 *
 * Codes come from `relaykit/types/error.go`; anything absent here keeps the
 * generic treatment, so an unmapped code degrades to today's behaviour rather
 * than to a blank box.
 *
 * `admin` copy is separate where the fix belongs to whoever can reach the
 * settings pages — telling a regular user to configure a channel is noise.
 */
const ERROR_EXPLANATIONS: Record<
  string,
  { title: string; body: string; adminBody?: string }
> = {
  model_price_error: {
    title: 'This model has no price set',
    body: 'Ask an administrator to set a price for this model.',
    adminBody:
      'Set a price to make it usable, under System Settings → Group and model pricing.',
  },
  model_not_found: {
    title: 'This model has no channel that can serve it',
    body: 'The model is listed but no upstream channel currently provides it. Try another model.',
    adminBody:
      'No enabled channel serves this model for the current group. Check the channel model list, or refetch it from the upstream.',
  },
  insufficient_user_quota: {
    title: 'Insufficient quota',
    body: 'Your remaining quota does not cover this request.',
  },
  'channel:no_available_key': {
    title: 'The channel has no usable key',
    body: 'Ask an administrator to check the channel configuration.',
    adminBody: 'Every key on the serving channel is disabled or exhausted.',
  },
  'channel:invalid_key': {
    title: 'The channel key was rejected',
    body: 'Ask an administrator to check the channel configuration.',
    adminBody: 'The upstream rejected the channel key as invalid or expired.',
  },
  sensitive_words_detected: {
    title: 'The request was blocked',
    body: 'The prompt tripped a content filter. Rewrite it and try again.',
  },
  prompt_blocked: {
    title: 'The request was blocked',
    body: 'The upstream refused the prompt. Rewrite it and try again.',
  },
}

type MessageErrorState = {
  /** Raw relay text. Shown as supporting detail when an explanation exists. */
  content: string
  kind: 'generic' | 'model-price'
  showSettingsLink: boolean
  /** Absent when the code is unmapped; the caller then shows `content` alone. */
  explanation?: { title: string; body: string }
}

/**
 * Strips the `Request error occurred: ` prefix that `updateAssistantMessageWithError`
 * prepends, so the raw text can sit under a written title without saying "an
 * error occurred" twice.
 */
function stripErrorTitlePrefix(content: string): string {
  const separator = content.indexOf(': ')
  return separator === -1 ? content : content.slice(separator + 2)
}

export function isAdminRole(role?: number | null): boolean {
  return role != null && role >= 10
}

/**
 * Whether the in-message alert can explain this code on its own.
 *
 * Used to suppress the toast: where a written title, a sentence and the raw
 * detail are already on screen, a second copy of the raw string in a corner adds
 * nothing and cannot be read before it disappears. Unmapped codes keep their
 * toast, since the message shows only the same raw text.
 */
export function hasErrorExplanation(errorCode?: string): boolean {
  return errorCode !== undefined && errorCode in ERROR_EXPLANATIONS
}

export function isErrorMessage(message: Message): boolean {
  return message.status === MESSAGE_STATUS.ERROR
}

export function getMessageErrorState(
  message: Message,
  isAdmin: boolean
): MessageErrorState | null {
  if (!isErrorMessage(message)) {
    return null
  }

  const rawContent = getMessageContent(message) || FALLBACK_ERROR_CONTENT
  const isModelPriceError = message.errorCode === MODEL_PRICE_ERROR_CODE
  const mapped = message.errorCode
    ? ERROR_EXPLANATIONS[message.errorCode]
    : undefined

  return {
    content: mapped ? stripErrorTitlePrefix(rawContent) : rawContent,
    kind: isModelPriceError ? 'model-price' : 'generic',
    showSettingsLink: isModelPriceError && isAdmin,
    explanation: mapped
      ? {
          title: mapped.title,
          body: isAdmin ? (mapped.adminBody ?? mapped.body) : mapped.body,
        }
      : undefined,
  }
}
