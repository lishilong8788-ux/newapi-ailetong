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
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

// The composer now reaches the model library (via the narrow-screen drawer),
// which renders vendor marks through `getLobeIcon` — that transitively loads
// `@lobehub/fluent-emoji`'s directory-style ES import the loader cannot resolve.
// Stubbed at the same boundary the pricing and model-library suites use.
vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

// The footer quotes the selected model's rate, which reads the shared status
// query for the top-up and exchange rates. Stubbed rather than wrapped in a
// `QueryClientProvider`: this suite is about paste-to-attach, and a real query
// client would make it wait on a fetch it does not care about.
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { price: 1, usd_exchange_rate: 1 } }),
}))

import { PlaygroundInput } from '../playground-input'

const models = [{ label: 'gpt-4o', value: 'gpt-4o' }]
const groups = [{ label: 'default', value: 'default', ratio: 1 }]

function renderInput(onSubmit: (text: string, images?: string[]) => void) {
  return render(
    <PlaygroundInput
      groups={groups}
      groupValue='default'
      modelValue='gpt-4o'
      models={models}
      onGroupChange={() => undefined}
      onModelChange={() => undefined}
      onParamChipChange={() => undefined}
      onSubmit={onSubmit}
      paramChipValues={{}}
    />
  )
}

function imageFile(name = 'screenshot.png'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/png' })
}

/**
 * jsdom never decodes an image, so `src` fires neither `load` nor `error` and
 * the compression step would stall until its timeout. Fire `error` instead:
 * compression then falls back to the original data URL, which is what this test
 * asserts on.
 */
function stubImageDecode(): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'src'
  )

  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    set(this: HTMLImageElement) {
      setTimeout(() => this.dispatchEvent(new Event('error')), 0)
    },
  })

  restoreImageSrc = () => {
    if (descriptor) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', descriptor)
      return
    }

    Reflect.deleteProperty(HTMLImageElement.prototype, 'src')
  }
}

let restoreImageSrc: (() => void) | undefined

afterEach(() => {
  restoreImageSrc?.()
  restoreImageSrc = undefined
})

/**
 * Clipboard image payloads reach the textarea as `clipboardData.items` entries;
 * `user-event`'s paste helper cannot carry files in this environment.
 */
function pasteFiles(target: HTMLElement, files: File[]): void {
  fireEvent.paste(target, {
    clipboardData: {
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
    },
  })
}

describe('PlaygroundInput image paste', () => {
  test('shows an attachment chip after an image is pasted into the textarea', async () => {
    renderInput(() => undefined)

    pasteFiles(screen.getByRole('textbox'), [imageFile()])

    expect(await screen.findByText('screenshot.png')).toBeInTheDocument()
  })

  test('submits the pasted image with the typed text', async () => {
    const onSubmit = vi.fn()
    const file = imageFile()
    // jsdom's fetch rejects blob: URLs, which the attachment pipeline uses to
    // turn the object URL back into a data URL before submitting.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: async () => file,
    } as unknown as Response)
    stubImageDecode()
    renderInput(onSubmit)

    const textarea = screen.getByRole('textbox')
    pasteFiles(textarea, [file])
    await screen.findByText('screenshot.png')
    fireEvent.change(textarea, { target: { value: 'what is this' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Send/ })[0])

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const [text, images] = onSubmit.mock.calls[0]
    expect(text).toBe('what is this')
    expect(images).toHaveLength(1)
    expect(images[0]).toMatch(/^data:image\//)
  })

  test('enables submit for an image-only input', async () => {
    renderInput(() => undefined)

    const sendButton = screen.getAllByRole('button', { name: /Send/ })[0]
    expect(sendButton).toBeDisabled()

    pasteFiles(screen.getByRole('textbox'), [imageFile()])

    await waitFor(() => expect(sendButton).toBeEnabled())
  })

  test('removes the attachment when its remove control is clicked', async () => {
    const user = userEvent.setup()
    renderInput(() => undefined)

    pasteFiles(screen.getByRole('textbox'), [imageFile()])
    await screen.findByText('screenshot.png')

    await user.click(screen.getByRole('button', { name: /Remove attachment/ }))

    expect(screen.queryByText('screenshot.png')).not.toBeInTheDocument()
  })
})
