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
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const openFileDialog = vi.fn()
const files: { id: string }[] = []

vi.mock('@/components/ai-elements/prompt-input', () => ({
  usePromptInputAttachments: () => ({ files, openFileDialog }),
}))

import { UploadChip } from '../upload-chip'

describe('UploadChip', () => {
  beforeEach(() => {
    files.length = 0
    openFileDialog.mockClear()
  })

  test('renders nothing for a modality that takes text only', () => {
    const { container } = render(<UploadChip upload={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  test('renders nothing for the voice picker', () => {
    // Picking a voice is not uploading a file, so it does not belong behind a
    // paperclip.
    const { container } = render(
      <UploadChip upload={{ kind: 'voice-picker' }} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  test('omits the counter while nothing is attached', () => {
    render(<UploadChip upload={{ kind: 'attachments', max: 10 }} />)

    // `0/10` on an empty composer reads like a quota warning, and the ceiling is
    // not information anyone needs before their first file.
    expect(screen.queryByText('0/10')).not.toBeInTheDocument()
  })

  test('shows the count against the ceiling once files are attached', () => {
    files.push({ id: 'a' }, { id: 'b' })

    render(<UploadChip upload={{ kind: 'attachments', max: 10 }} />)

    expect(screen.getByText('2/10')).toBeInTheDocument()
  })

  test('opens the file dialog, which was previously unreachable', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')

    render(<UploadChip upload={{ kind: 'attachments', max: 10 }} />)
    await userEvent.click(screen.getByRole('button'))

    // The registry has declared `max: 10` since it was written, but paste and
    // drag were the only ways in.
    expect(openFileDialog).toHaveBeenCalled()
  })

  test('disables itself at the ceiling', () => {
    files.push({ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' })

    render(
      <UploadChip
        upload={{
          kind: 'reference-slot',
          label: 'Upload reference image',
          max: 4,
        }}
      />
    )

    expect(screen.getByRole('button')).toBeDisabled()
  })
})
