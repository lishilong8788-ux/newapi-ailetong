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
import { describe, expect, test } from 'vitest'

import { getAttachmentImageUrls } from '../input/input-attachment-utils'
import {
  getInputControlState,
  getSubmittableInput,
} from '../input/input-control-utils'

const PNG_DATA_URL = 'data:image/png;base64,AAAA'

const controlStateBase = {
  hasStopHandler: false,
  models: [{ label: 'gpt-4o', value: 'gpt-4o' }],
}

describe('getAttachmentImageUrls', () => {
  test('keeps only attachments that carry an image media type and a url', () => {
    const urls = getAttachmentImageUrls([
      { mediaType: 'image/png', url: PNG_DATA_URL },
      { mediaType: 'application/pdf', url: 'data:application/pdf;base64,AAAA' },
      { mediaType: 'image/webp' },
    ])

    expect(urls).toEqual([PNG_DATA_URL])
  })
})

describe('getSubmittableInput', () => {
  test('returns the pasted image when the text is empty', () => {
    const submittable = getSubmittableInput({
      text: '   ',
      files: [{ mediaType: 'image/png', url: PNG_DATA_URL }],
    })

    expect(submittable).toEqual({ images: [PNG_DATA_URL], text: '   ' })
  })

  test('returns null when neither text nor image is present', () => {
    expect(getSubmittableInput({ text: '  ', files: [] })).toBeNull()
  })

  test('returns null while the input is disabled even with an image attached', () => {
    const submittable = getSubmittableInput(
      { text: 'hello', files: [{ mediaType: 'image/png', url: PNG_DATA_URL }] },
      true
    )

    expect(submittable).toBeNull()
  })
})

describe('getInputControlState', () => {
  test('enables submit for an image-only input', () => {
    const state = getInputControlState({
      ...controlStateBase,
      attachmentCount: 1,
      text: '',
    })

    expect(state.canSubmit).toBe(true)
  })

  test('keeps submit disabled when there is no text and no attachment', () => {
    const state = getInputControlState({ ...controlStateBase, text: '' })

    expect(state.canSubmit).toBe(false)
  })
})
