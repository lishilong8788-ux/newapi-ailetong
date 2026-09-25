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
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const getCopilotImageBlob = vi.fn()

vi.mock('../api', () => ({
  getCopilotImageBlob: (path: string) => getCopilotImageBlob(path),
}))

import { CopilotTurnImages } from '../components/copilot-turn-images'

afterEach(() => {
  getCopilotImageBlob.mockReset()
})

describe('rendering the images on a user turn', () => {
  // The turn just sent already holds the bytes; going back to the server for them
  // would put a spinner in front of a screenshot the operator is looking at.
  test('renders a data url without fetching', () => {
    render(<CopilotTurnImages images={['data:image/webp;base64,AAAA']} />)

    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'data:image/webp;base64,AAAA'
    )
    expect(getCopilotImageBlob).not.toHaveBeenCalled()
  })

  // A stored path has to be fetched with the auth header and handed to the img as
  // an object URL: the browser cannot attach headers to an image request.
  test('fetches a stored path and renders it as an object url', async () => {
    getCopilotImageBlob.mockResolvedValue(new Blob(['x']))

    render(<CopilotTurnImages images={['12/a.webp']} />)

    await waitFor(() =>
      expect(getCopilotImageBlob).toHaveBeenCalledWith('12/a.webp')
    )
    await waitFor(() =>
      expect(screen.getByRole('img')).toHaveAttribute(
        'src',
        expect.stringMatching(/^blob:/)
      )
    )
  })

  // A screenshot that no longer exists leaves a broken tile; the rest of the
  // transcript is what the operator came back to read.
  test('survives a failed fetch', async () => {
    getCopilotImageBlob.mockRejectedValue(new Error('gone'))

    render(<CopilotTurnImages images={['12/missing.webp']} />)

    await waitFor(() => expect(getCopilotImageBlob).toHaveBeenCalled())
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  test('renders nothing when there are no images', () => {
    const { container } = render(<CopilotTurnImages images={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  // Revoking on unmount matters here: these are full screenshots, and a long
  // conversation would otherwise hold every one of them for the life of the tab.
  test('revokes object urls on unmount', async () => {
    getCopilotImageBlob.mockResolvedValue(new Blob(['x']))
    const revoke = vi.spyOn(URL, 'revokeObjectURL')

    const { unmount } = render(<CopilotTurnImages images={['12/a.webp']} />)
    await waitFor(() =>
      expect(screen.getByRole('img')).toHaveAttribute(
        'src',
        expect.stringMatching(/^blob:/)
      )
    )

    unmount()
    expect(revoke).toHaveBeenCalled()
    revoke.mockRestore()
  })
})
