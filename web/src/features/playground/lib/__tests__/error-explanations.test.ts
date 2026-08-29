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
import { describe, expect, it } from 'vitest'

import { MESSAGE_ROLES, MESSAGE_STATUS } from '../../constants'
import type { Message } from '../../types'
import {
  getMessageErrorState,
  hasErrorExplanation,
} from '../message/message-error-utils'

const RELAY_TEXT =
  'Request error occurred: No available channel for model BLOOMZ-7B under group default (distributor) (request id: 2026082612)'

function errorMessage(errorCode?: string, content = RELAY_TEXT): Message {
  return {
    key: 'm1',
    from: MESSAGE_ROLES.ASSISTANT,
    versions: [{ id: 'v1', content }],
    status: MESSAGE_STATUS.ERROR,
    createdAt: 0,
    errorCode: errorCode ?? null,
  } as Message
}

describe('getMessageErrorState / explanations', () => {
  it('explains a missing channel and keeps the relay text as detail', () => {
    const state = getMessageErrorState(errorMessage('model_not_found'), false)

    expect(state?.explanation?.title).toBe(
      'This model has no channel that can serve it'
    )
    // The `Request error occurred: ` prefix is stripped so the detail line does
    // not repeat what the title already says.
    expect(state?.content.startsWith('No available channel')).toBe(true)
  })

  it('gives admins the actionable wording', () => {
    const user = getMessageErrorState(errorMessage('model_not_found'), false)
    const admin = getMessageErrorState(errorMessage('model_not_found'), true)

    expect(admin?.explanation?.body).not.toBe(user?.explanation?.body)
    expect(admin?.explanation?.body).toContain('channel model list')
  })

  it('falls back to the raw text for an unmapped code', () => {
    const state = getMessageErrorState(errorMessage('some_new_code'), false)

    expect(state?.explanation).toBeUndefined()
    // Unprefixed, exactly as before this mapping existed.
    expect(state?.content).toBe(RELAY_TEXT)
  })

  it('still routes the price error to its own branch', () => {
    const state = getMessageErrorState(errorMessage('model_price_error'), true)

    expect(state?.kind).toBe('model-price')
    expect(state?.showSettingsLink).toBe(true)
  })

  it('reports which codes suppress the toast', () => {
    expect(hasErrorExplanation('model_not_found')).toBe(true)
    expect(hasErrorExplanation('channel:invalid_key')).toBe(true)
    expect(hasErrorExplanation('some_new_code')).toBe(false)
    expect(hasErrorExplanation(undefined)).toBe(false)
  })
})
