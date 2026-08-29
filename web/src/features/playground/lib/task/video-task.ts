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
import type {
  VideoSubmitResponse,
  VideoTaskResponse,
  VideoTaskStatus,
} from '../../types'

/** Statuses that end polling. Anything else means "ask again". */
const TERMINAL_STATUSES = new Set<VideoTaskStatus>(['SUCCESS', 'FAILURE'])

/**
 * The task id from a submit response.
 *
 * Four shapes are accepted because the field depends on which platform served
 * the submission: the OpenAI video API answers `{id}`, the task API answers
 * `{task_id}`, and both appear either at the root or under `data`. Taking the
 * first recognised one keeps that variance out of the caller.
 */
export function extractTaskId(response: VideoSubmitResponse): string | null {
  const candidates = [
    response.task_id,
    response.id,
    response.data?.task_id,
    response.data?.id,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate
    }
  }

  return null
}

export type VideoTaskState = {
  status: VideoTaskStatus
  /** 0-100, or undefined when the platform reports no progress. */
  progress: number | undefined
  resultUrl: string | undefined
  failReason: string | undefined
  isTerminal: boolean
}

/**
 * Percent as a number, from either `50` or `"50%"`.
 *
 * Platforms disagree on the type, and a string reaching a width style produces
 * `width: "50%%"` — a silently broken bar rather than a crash, which is why this
 * is normalised at the boundary instead of at the point of use.
 */
function parseProgress(progress: number | string | undefined): number | undefined {
  if (typeof progress === 'number' && Number.isFinite(progress)) {
    return clampPercent(progress)
  }

  if (typeof progress === 'string') {
    const parsed = Number.parseFloat(progress.replace('%', '').trim())
    if (Number.isFinite(parsed)) {
      return clampPercent(parsed)
    }
  }

  return undefined
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/**
 * Read a poll response into the shape the UI needs.
 *
 * An absent or unrecognised status becomes `UNKNOWN` and is treated as
 * non-terminal: polling continues and eventually times out on the caller's own
 * deadline. The alternative — guessing at failure — would abandon a task that is
 * merely being described in a way this code has not seen.
 */
export function parseVideoTaskState(
  response: VideoTaskResponse
): VideoTaskState {
  const data = response.data
  const status = data?.status ?? 'UNKNOWN'
  const resultUrl = data?.result_url?.trim()
  const failReason = data?.fail_reason?.trim()

  return {
    status,
    progress: parseProgress(data?.progress),
    resultUrl: resultUrl === '' ? undefined : resultUrl,
    failReason: failReason === '' ? undefined : failReason,
    isTerminal: TERMINAL_STATUSES.has(status),
  }
}

/**
 * Whether a terminal task actually produced something playable.
 *
 * `SUCCESS` with no URL is treated as a failure: the task is over and there is
 * nothing to show, so reporting success would leave an empty player on screen
 * with no explanation.
 */
export function isVideoTaskSuccessful(state: VideoTaskState): boolean {
  return state.status === 'SUCCESS' && state.resultUrl !== undefined
}
