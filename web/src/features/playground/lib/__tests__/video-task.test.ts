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

import {
  extractTaskId,
  isVideoTaskSuccessful,
  parseVideoTaskState,
} from '../task/video-task'

describe('extractTaskId', () => {
  // Four shapes, because the field depends on which platform served the submit.
  test('reads task_id at the root', () => {
    expect(extractTaskId({ task_id: 'abc' })).toBe('abc')
  })

  test('reads the OpenAI video API id', () => {
    expect(extractTaskId({ id: 'video_123' })).toBe('video_123')
  })

  test('reads either field nested under data', () => {
    expect(extractTaskId({ data: { task_id: 'nested' } })).toBe('nested')
    expect(extractTaskId({ data: { id: 'nested-id' } })).toBe('nested-id')
  })

  test('returns null when no id is present', () => {
    expect(extractTaskId({})).toBeNull()
  })

  // A blank id would be sent straight back as a fetch URL and 404 on every poll.
  test('treats a blank id as absent', () => {
    expect(extractTaskId({ task_id: '   ' })).toBeNull()
  })
})

describe('parseVideoTaskState / progress', () => {
  test('accepts a bare number', () => {
    expect(parseVideoTaskState({ data: { progress: 42 } }).progress).toBe(42)
  })

  // Some platforms send "50%". Left as a string it reaches a width style and
  // produces `width: "50%%"` — a silently broken bar, not a crash.
  test('accepts a percent string', () => {
    expect(parseVideoTaskState({ data: { progress: '50%' } }).progress).toBe(50)
  })

  test('clamps out-of-range values', () => {
    expect(parseVideoTaskState({ data: { progress: 140 } }).progress).toBe(100)
    expect(parseVideoTaskState({ data: { progress: -5 } }).progress).toBe(0)
  })

  test('reports undefined rather than zero when absent', () => {
    // Zero would render an empty bar, claiming "no work done yet" about a
    // platform that simply does not report progress.
    expect(parseVideoTaskState({ data: {} }).progress).toBeUndefined()
    expect(
      parseVideoTaskState({ data: { progress: 'unknown' } }).progress
    ).toBeUndefined()
  })
})

describe('parseVideoTaskState / terminal states', () => {
  test('SUCCESS and FAILURE end polling', () => {
    expect(parseVideoTaskState({ data: { status: 'SUCCESS' } }).isTerminal).toBe(
      true
    )
    expect(parseVideoTaskState({ data: { status: 'FAILURE' } }).isTerminal).toBe(
      true
    )
  })

  test('in-flight states do not', () => {
    for (const status of ['NOT_START', 'SUBMITTED', 'QUEUED', 'IN_PROGRESS']) {
      expect(
        parseVideoTaskState({ data: { status: status as never } }).isTerminal
      ).toBe(false)
    }
  })

  // Guessing failure would abandon a task that is merely described in a way this
  // code has not seen; the caller's own deadline is what stops the polling.
  test('an unrecognised status keeps polling', () => {
    const state = parseVideoTaskState({ data: { status: undefined } })

    expect(state.status).toBe('UNKNOWN')
    expect(state.isTerminal).toBe(false)
  })

  test('blank strings are reported as absent, not empty', () => {
    const state = parseVideoTaskState({
      data: { status: 'SUCCESS', result_url: '  ', fail_reason: '' },
    })

    expect(state.resultUrl).toBeUndefined()
    expect(state.failReason).toBeUndefined()
  })
})

describe('isVideoTaskSuccessful', () => {
  test('requires a playable URL, not just the status', () => {
    // SUCCESS with nothing to play would leave an empty player on screen with no
    // explanation, which reads as a broken page rather than a failed task.
    const withUrl = parseVideoTaskState({
      data: { status: 'SUCCESS', result_url: 'https://example.com/v.mp4' },
    })
    const withoutUrl = parseVideoTaskState({ data: { status: 'SUCCESS' } })

    expect(isVideoTaskSuccessful(withUrl)).toBe(true)
    expect(isVideoTaskSuccessful(withoutUrl)).toBe(false)
  })
})
