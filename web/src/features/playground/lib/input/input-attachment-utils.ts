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

/** Images pasted or picked in the playground input. */
export const MAX_INPUT_IMAGES = 6
export const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024
export const INPUT_IMAGE_ACCEPT = 'image/*'

/**
 * Screenshots arrive as multi-megabyte PNGs. Re-encoding keeps the request
 * payload and the persisted conversation small enough to survive a reload.
 */
const COMPRESSED_IMAGE_MAX_EDGE = 1568
const COMPRESSED_IMAGE_MIME = 'image/webp'
const COMPRESSED_IMAGE_QUALITY = 0.82
/** A decode that neither loads nor errors must not block submitting. */
const IMAGE_DECODE_TIMEOUT_MS = 5_000

type AttachmentLike = {
  mediaType?: string
  url?: string
}

export function isImageAttachment(attachment: AttachmentLike): boolean {
  return Boolean(attachment.mediaType?.startsWith('image/') && attachment.url)
}

export function getAttachmentImageUrls(
  attachments: AttachmentLike[] = []
): string[] {
  const urls: string[] = []

  for (const attachment of attachments) {
    if (isImageAttachment(attachment) && attachment.url) {
      urls.push(attachment.url)
    }
  }

  return urls
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timer = setTimeout(
      () => reject(new Error('Timed out decoding image')),
      IMAGE_DECODE_TIMEOUT_MS
    )
    const settle = (run: () => void) => {
      clearTimeout(timer)
      run()
    }

    image.addEventListener('load', () => settle(() => resolve(image)), {
      once: true,
    })
    image.addEventListener(
      'error',
      () => settle(() => reject(new Error('Failed to decode image'))),
      { once: true }
    )
    image.src = dataUrl
  })
}

/**
 * Downscale and re-encode a data URL. Returns the input unchanged when the
 * browser cannot decode it or when re-encoding would not shrink the payload.
 */
export async function compressImageDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) {
    return dataUrl
  }

  try {
    const image = await loadImageElement(dataUrl)
    const { naturalWidth, naturalHeight } = image
    if (!naturalWidth || !naturalHeight) {
      return dataUrl
    }

    const scale = Math.min(
      1,
      COMPRESSED_IMAGE_MAX_EDGE / Math.max(naturalWidth, naturalHeight)
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(naturalHeight * scale))

    const context = canvas.getContext('2d')
    if (!context) {
      return dataUrl
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const encoded = canvas.toDataURL(
      COMPRESSED_IMAGE_MIME,
      COMPRESSED_IMAGE_QUALITY
    )

    if (!encoded.startsWith(`data:${COMPRESSED_IMAGE_MIME}`)) {
      return dataUrl
    }

    return encoded.length < dataUrl.length ? encoded : dataUrl
  } catch {
    return dataUrl
  }
}

export function compressImageDataUrls(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(compressImageDataUrl))
}
