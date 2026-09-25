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
import { api } from '@/lib/api'

import { COPILOT_ENDPOINTS, SESSION_PAGE_SIZE } from './constants'
import type {
  CopilotConfigUpdate,
  CopilotEnvelope,
  CopilotModelsData,
  CopilotSession,
  CopilotSessionDetail,
  CopilotSessionPage,
  CopilotStatus,
} from './types'

/**
 * Fetches one stored session image as a blob.
 *
 * A blob rather than pointing an `<img>` at the endpoint: the dashboard
 * authenticates with an `Authorization` header and has no cookie fallback, and a
 * browser cannot attach headers to an image request. So the bytes come through
 * the same client as everything else, and the caller turns them into an object
 * URL.
 */
export async function getCopilotImageBlob(path: string): Promise<Blob> {
  const res = await api.get(COPILOT_ENDPOINTS.IMAGES, {
    params: { path },
    responseType: 'blob',
    skipBusinessError: true,
  })
  return res.data as Blob
}

export async function getCopilotStatus(): Promise<
  CopilotEnvelope<CopilotStatus>
> {
  const res = await api.get<CopilotEnvelope<CopilotStatus>>(
    COPILOT_ENDPOINTS.STATUS,
    // The page renders a notice for `configured: false` and the route is
    // admin-gated, so a failure here is reported in place rather than as a toast
    // the reader has to dismiss before seeing the same thing written on the page.
    { skipErrorHandler: true }
  )
  return res.data
}

/**
 * The session list, normalised to a page.
 *
 * Tolerates a bare array as well as the repo's `{items, total}` envelope: the
 * contract says "paginated list" without pinning the wrapper, and a rail that
 * renders nothing because the shape differed by one level would be a silent
 * failure.
 */
export async function getCopilotSessions(
  page = 1
): Promise<CopilotEnvelope<CopilotSessionPage>> {
  const res = await api.get<
    CopilotEnvelope<CopilotSession[] | CopilotSessionPage>
  >(COPILOT_ENDPOINTS.SESSIONS, {
    params: { page, page_size: SESSION_PAGE_SIZE },
  })

  const body = res.data
  if (Array.isArray(body.data)) {
    return {
      success: body.success,
      message: body.message,
      data: { items: body.data, total: body.data.length },
    }
  }

  return body as CopilotEnvelope<CopilotSessionPage>
}

export async function createCopilotSession(): Promise<
  CopilotEnvelope<CopilotSession>
> {
  const res = await api.post<CopilotEnvelope<CopilotSession>>(
    COPILOT_ENDPOINTS.SESSIONS
  )
  return res.data
}

export async function getCopilotSession(
  id: number
): Promise<CopilotEnvelope<CopilotSessionDetail>> {
  const res = await api.get<CopilotEnvelope<CopilotSessionDetail>>(
    `${COPILOT_ENDPOINTS.SESSIONS}/${id}`
  )
  return res.data
}

export async function deleteCopilotSession(
  id: number
): Promise<CopilotEnvelope<unknown>> {
  const res = await api.delete<CopilotEnvelope<unknown>>(
    `${COPILOT_ENDPOINTS.SESSIONS}/${id}`
  )
  return res.data
}

export function getCopilotChatUrl(sessionId: number): string {
  return `${COPILOT_ENDPOINTS.SESSIONS}/${sessionId}/chat`
}

/**
 * The model + channel pairs this copilot may be pointed at.
 *
 * Errors are reported in place by the picker rather than as a toast: an operator
 * who opens the list and finds it empty needs to know why right where they are
 * looking.
 */
export async function getCopilotModels(): Promise<
  CopilotEnvelope<CopilotModelsData>
> {
  const res = await api.get<CopilotEnvelope<CopilotModelsData>>(
    COPILOT_ENDPOINTS.MODELS,
    { skipErrorHandler: true }
  )
  return res.data
}

/**
 * Writes the copilot's own selection, returning the resulting status.
 *
 * Same options the settings page writes, so the two stay one source of truth. The
 * response is the full status, which lets the caller refresh from the write
 * instead of racing a follow-up GET.
 */
export async function updateCopilotConfig(
  update: CopilotConfigUpdate
): Promise<CopilotEnvelope<CopilotStatus>> {
  const res = await api.put<CopilotEnvelope<CopilotStatus>>(
    COPILOT_ENDPOINTS.CONFIG,
    update,
    { skipErrorHandler: true }
  )
  return res.data
}
