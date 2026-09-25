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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { MAX_INPUT_IMAGES } from '@/features/playground/lib/input/input-attachment-utils'

// Re-encoding needs a real canvas, which jsdom does not have. Stubbed to identity:
// these tests are about whether attachments reach `onSubmit`, not about the
// compression itself (covered in the playground's own suite).
vi.mock('@/features/playground/lib/input/input-attachment-utils', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/playground/lib/input/input-attachment-utils')
  >('@/features/playground/lib/input/input-attachment-utils')
  return { ...actual, compressImageDataUrls: (urls: string[]) => urls }
})

import { CopilotComposer } from '../components/copilot-composer'

function pasteImage(textarea: HTMLElement, name = 'screenshot.png') {
  const file = new File(['fake-png-bytes'], name, { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    },
  })
}

/** Submits by form rather than by clicking, so the disabled cases are reachable. */
function submitComposer() {
  const form = screen.getByRole('textbox').closest('form')
  if (!form) throw new Error('composer form not found')
  fireEvent.submit(form)
}

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof CopilotComposer>> = {}
) {
  const onSubmit = vi.fn()
  const result = render(
    <CopilotComposer
      value=''
      onChange={() => {}}
      onSubmit={onSubmit}
      onStop={() => {}}
      isStreaming={false}
      {...overrides}
    />
  )
  return { onSubmit, ...result }
}

describe('pasting a screenshot into the copilot composer', () => {
  test('attaching an image enables send with no text typed', async () => {
    renderComposer()

    const send = screen.getByRole('button', { name: /send/i })
    expect(send).toBeDisabled()

    pasteImage(screen.getByRole('textbox'))

    // An image alone is a question ("what's wrong with this table?"), so send has
    // to come alive without a caption.
    await waitFor(() => expect(send).toBeEnabled())
  })

  test('submitting sends the attached image as a data url', async () => {
    const { onSubmit } = renderComposer({ value: 'which channel is losing' })

    pasteImage(screen.getByRole('textbox'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send/i })).toBeEnabled()
    )

    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const images = onSubmit.mock.calls[0][0] as string[]
    expect(images).toHaveLength(1)
    expect(images[0]).toMatch(/^data:image\/png/)
  })

  // Paste and drag both work without it, but neither is discoverable: without a
  // visible control the feature does not exist for anyone who does not try Ctrl+V.
  test('offers a visible attach control', () => {
    renderComposer()
    // Exact name: each attached chip also carries a "Remove attachment" button.
    expect(screen.getByRole('button', { name: 'Attach' })).toBeEnabled()
  })

  test('the attach control goes dead once the image limit is reached', async () => {
    renderComposer()
    const textarea = screen.getByRole('textbox')

    for (let index = 0; index < MAX_INPUT_IMAGES; index += 1) {
      pasteImage(textarea, `shot-${index}.png`)
    }

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled()
    )
  })

  test('a disabled composer does not submit', async () => {
    const { onSubmit } = renderComposer({ value: 'q', disabled: true })

    submitComposer()

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled())
  })

  // While a reply is streaming the send button is replaced by stop; submitting
  // anyway (Enter) must not queue a second turn.
  test('does not submit while streaming', async () => {
    const { onSubmit } = renderComposer({ value: 'q', isStreaming: true })

    submitComposer()

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
  })
})
