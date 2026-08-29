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
import { MESSAGE_STATUS, STORAGE_KEYS } from '../../constants'
import type {
  PlaygroundConfig,
  PlaygroundConversations,
  Message,
} from '../../types'
import {
  finalizeMessage,
  isAssistantMessagePending,
  sanitizeMessagesOnLoad,
} from '../message/message-streaming-utils'
import { completeAssistantTiming } from '../message/message-timing-utils'
import { hasMessageContent } from '../message/message-utils'
import {
  MAX_LOADED_MESSAGE_CHARS,
  MAX_LOADED_MESSAGES_CHARS,
  MAX_STORED_CONVERSATIONS,
  MAX_STORED_IMAGE_CHARS,
  MAX_STORED_MESSAGES,
  MAX_STORED_MESSAGES_BYTES,
  STORAGE_VERSION,
  conversationsSchema,
  messagesSchema,
  playgroundConfigSchema,
} from './storage-schema'

type StoredEnvelope<T> = {
  version: number
  data: T
}

const TRUNCATED_CONTENT_SUFFIX = '\n\n[...]'
const MIN_PREFIX_COLLAPSE_LENGTH = 2000
const MIN_REPEATED_SECTION_COUNT = 3
const SECTION_HEADING_LINE_PATTERN = /^#{2,6}\s+\d+\.\s+.+$/gm

function readStoredValue(key: string): unknown | null {
  const saved = localStorage.getItem(key)
  if (!saved) return null

  return JSON.parse(saved) as unknown
}

function readBudgetedStoredValue(key: string): unknown | null {
  const saved = localStorage.getItem(key)
  if (!saved) return null

  if (saved.length > MAX_STORED_MESSAGES_BYTES) {
    localStorage.removeItem(key)
    return null
  }

  return JSON.parse(saved) as unknown
}

function unwrapStoredValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value
  }

  if ('version' in value && 'data' in value) {
    return (value as StoredEnvelope<unknown>).data
  }

  return value
}

function writeStoredValue<T>(key: string, data: T): void {
  const payload: StoredEnvelope<T> = {
    version: STORAGE_VERSION,
    data,
  }

  localStorage.setItem(key, JSON.stringify(payload))
}

function trimMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_STORED_MESSAGES) {
    return messages
  }

  return messages.slice(-MAX_STORED_MESSAGES)
}

function stripMessageImages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (!message.images) {
      return message
    }

    const { images: _images, ...rest } = message
    return rest
  })
}

function getMessageImagesSize(message: Message): number {
  return (message.images ?? []).reduce(
    (total, image) => total + image.length,
    0
  )
}

/**
 * Keep image attachments for the newest messages within the image budget and
 * drop the rest, so a large screenshot never costs the whole conversation.
 */
function trimMessageImagesByBudget(messages: Message[]): Message[] {
  let remaining = MAX_STORED_IMAGE_CHARS
  let changed = false
  const result = [...messages]

  for (let index = result.length - 1; index >= 0; index--) {
    const message = result[index]
    const imagesSize = getMessageImagesSize(message)
    if (imagesSize === 0) {
      continue
    }

    if (imagesSize > remaining) {
      const { images: _images, ...rest } = message
      result[index] = rest
      changed = true
      continue
    }

    remaining -= imagesSize
  }

  return changed ? result : messages
}

function getMessageSize(message: Message): number {
  const versionsSize = message.versions.reduce(
    (total, version) => total + version.content.length,
    0
  )
  const reasoningSize = message.reasoning?.content.length ?? 0

  return versionsSize + reasoningSize
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  if (maxLength <= TRUNCATED_CONTENT_SUFFIX.length) {
    return text.slice(0, maxLength)
  }

  return `${text.slice(0, maxLength - TRUNCATED_CONTENT_SUFFIX.length)}${TRUNCATED_CONTENT_SUFFIX}`
}

type SectionOccurrence = {
  heading: string
  index: number
}

function getSectionOccurrences(text: string): SectionOccurrence[] {
  const occurrences: SectionOccurrence[] = []
  const matches = text.matchAll(SECTION_HEADING_LINE_PATTERN)
  for (const match of matches) {
    const index = match.index
    if (index === undefined) {
      continue
    }

    occurrences.push({
      heading: match[0],
      index,
    })
  }

  return occurrences
}

function getHeadingCounts(
  occurrences: SectionOccurrence[]
): Map<string, number> {
  const counts = new Map<string, number>()

  for (const occurrence of occurrences) {
    counts.set(occurrence.heading, (counts.get(occurrence.heading) ?? 0) + 1)
  }

  return counts
}

function findLastRepeatedSectionRunStart(text: string): number {
  const occurrences = getSectionOccurrences(text)
  const headingCounts = getHeadingCounts(occurrences)
  const lastRepeatedIndexes: number[] = []
  const seenHeadings = new Set<string>()

  for (let index = occurrences.length - 1; index >= 0; index--) {
    const occurrence = occurrences[index]
    const count = headingCounts.get(occurrence.heading) ?? 0

    if (
      count < MIN_REPEATED_SECTION_COUNT ||
      seenHeadings.has(occurrence.heading)
    ) {
      continue
    }

    seenHeadings.add(occurrence.heading)
    lastRepeatedIndexes.push(occurrence.index)
  }

  if (lastRepeatedIndexes.length === 0) {
    return -1
  }

  return Math.min(...lastRepeatedIndexes)
}

function collapseRepeatedSectionSnapshots(text: string): string {
  if (text.length < MIN_PREFIX_COLLAPSE_LENGTH) {
    return text
  }

  const lastRepeatedRunStart = findLastRepeatedSectionRunStart(text)
  if (lastRepeatedRunStart === -1) {
    return text
  }

  return text.slice(lastRepeatedRunStart)
}

function normalizeStoredMessageForLoad(message: Message): Message {
  let changed = false
  const versions = message.versions.map((version) => {
    const collapsedContent = collapseRepeatedSectionSnapshots(version.content)
    const content = truncateText(collapsedContent, MAX_LOADED_MESSAGE_CHARS)

    if (content === version.content && collapsedContent === version.content) {
      return version
    }

    changed = true
    return {
      ...version,
      content,
    }
  })

  const reasoning = message.reasoning
    ? {
        ...message.reasoning,
        content: truncateText(
          message.reasoning.content,
          MAX_LOADED_MESSAGE_CHARS
        ),
      }
    : undefined

  if (reasoning?.content !== message.reasoning?.content) {
    changed = true
  }

  const normalized = changed ? { ...message, versions, reasoning } : message

  if (!isAssistantMessagePending(normalized)) {
    return normalized
  }

  const hasContent = hasMessageContent(normalized)
  const hasReasoning = normalized.reasoning?.content.trim()

  /**
   * A pending message with nothing in it lost its request when the page went
   * away, and no duration for it is knowable.
   *
   * It still has to come back *final*. Left pending it was a trap: the next
   * `completeAssistantMessage` — from the stop button, or from a model switch
   * back when that stopped generation — stamped it with `Date.now()`, and
   * `completeAssistantTiming` measured from a `startedAt` belonging to the
   * previous session. That is where "response time: 48554.10s" came from: a
   * request that died in one minute, wearing the 13.5 hours until someone next
   * clicked something.
   *
   * `durationMs` stays undefined rather than 0, because 0 claims an instant
   * reply. `MessageMetadata` renders no duration at all for undefined, which is
   * the honest answer.
   */
  if (!hasContent && !hasReasoning) {
    return {
      ...normalized,
      status: MESSAGE_STATUS.COMPLETE,
      isReasoningStreaming: false,
      durationMs: undefined,
      completedAt: undefined,
    }
  }

  const completedAt =
    normalized.completedAt ??
    normalized.reasoning?.completedAt ??
    normalized.startedAt ??
    normalized.createdAt ??
    Date.now()

  return completeAssistantTiming(
    {
      ...finalizeMessage(normalized),
      status: MESSAGE_STATUS.COMPLETE,
      isReasoningStreaming: false,
    },
    completedAt
  )
}

function trimMessagesByContentSize(messages: Message[]): Message[] {
  let totalSize = 0
  const result: Message[] = []

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const messageSize = getMessageSize(message)

    if (
      result.length > 0 &&
      totalSize + messageSize > MAX_LOADED_MESSAGES_CHARS
    ) {
      break
    }

    totalSize += messageSize
    result.push(message)
  }

  return result.reverse()
}

/**
 * Load playground config from localStorage
 */
export function loadConfig(): Partial<PlaygroundConfig> {
  try {
    const saved = readStoredValue(STORAGE_KEYS.CONFIG)
    if (!saved) return {}

    return playgroundConfigSchema.parse(unwrapStoredValue(saved))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load config:', error)
  }
  return {}
}

/**
 * Save playground config to localStorage
 */
export function saveConfig(config: Partial<PlaygroundConfig>): void {
  try {
    const parsed = playgroundConfigSchema.parse(config)
    writeStoredValue(STORAGE_KEYS.CONFIG, parsed)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save config:', error)
  }
}

/**
 * Normalize one stored transcript the way a single flat history used to be:
 * repair interrupted streams, drop over-long content, cap the message count.
 */
function normalizeLoadedMessages(messages: Message[]): Message[] {
  const normalized = messages.map(normalizeStoredMessageForLoad)
  return sanitizeMessagesOnLoad(
    trimMessagesByContentSize(trimMessages(normalized))
  )
}

/**
 * Read the pre-per-model `playground_messages` array, if it is still there.
 *
 * The old key held one history with no record of which model produced it, so the
 * caller files it under whichever model is active — the same model the user was
 * last talking to, since config and history were saved side by side. The key is
 * removed either way: a second read would re-import an already-migrated
 * transcript over a newer one.
 */
function takeLegacyMessages(): Message[] | null {
  try {
    const saved = readBudgetedStoredValue(STORAGE_KEYS.LEGACY_MESSAGES)
    localStorage.removeItem(STORAGE_KEYS.LEGACY_MESSAGES)
    if (!saved) return null

    const parsed = messagesSchema.parse(unwrapStoredValue(saved)) as Message[]
    const normalized = normalizeLoadedMessages(parsed)

    return normalized.length > 0 ? normalized : null
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to migrate legacy messages:', error)
  }
  return null
}

/**
 * Load every model's transcript, migrating the legacy single history into
 * `activeModel` on first run.
 */
export function loadConversations(
  activeModel: string
): PlaygroundConversations {
  let conversations: PlaygroundConversations = {}

  try {
    const saved = readBudgetedStoredValue(STORAGE_KEYS.CONVERSATIONS)
    if (saved) {
      const parsed = conversationsSchema.parse(
        unwrapStoredValue(saved)
      ) as PlaygroundConversations

      for (const [model, conversation] of Object.entries(parsed)) {
        const messages = normalizeLoadedMessages(conversation.messages)
        if (messages.length === 0) continue

        conversations[model] = { messages, updatedAt: conversation.updatedAt }
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load conversations:', error)
    conversations = {}
  }

  const legacyMessages = takeLegacyMessages()
  if (legacyMessages && activeModel && !conversations[activeModel]) {
    conversations[activeModel] = {
      messages: legacyMessages,
      updatedAt: Date.now(),
    }
  }

  return conversations
}

/**
 * Drop empty transcripts, keep the newest `MAX_STORED_CONVERSATIONS`, and trim
 * each survivor's messages and attachments.
 */
function prepareConversationsForSave(
  conversations: PlaygroundConversations
): PlaygroundConversations {
  const ordered = Object.entries(conversations)
    .filter(([, conversation]) => conversation.messages.length > 0)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_CONVERSATIONS)

  const prepared: PlaygroundConversations = {}
  for (const [model, conversation] of ordered) {
    prepared[model] = {
      messages: trimMessageImagesByBudget(trimMessages(conversation.messages)),
      updatedAt: conversation.updatedAt,
    }
  }

  return prepared
}

/**
 * Persist every model's transcript under one key.
 *
 * Three attempts, each cheaper than the last, because attachments make the
 * payload unpredictable and a quota rejection must not cost the whole history:
 * as written, then with attachments stripped from all but the newest transcript,
 * then with the newest transcript alone. The active conversation is the one the
 * user is looking at, so it is the last thing given up.
 */
export function saveConversations(
  conversations: PlaygroundConversations
): void {
  const prepared = prepareConversationsForSave(conversations)

  try {
    writeStoredValue(
      STORAGE_KEYS.CONVERSATIONS,
      conversationsSchema.parse(prepared)
    )
    return
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save conversations:', error)
  }

  const entries = Object.entries(prepared).sort(
    ([, a], [, b]) => b.updatedAt - a.updatedAt
  )
  if (entries.length === 0) return

  const [newestModel, newest] = entries[0]
  const withoutOlderImages: PlaygroundConversations = { [newestModel]: newest }
  for (const [model, conversation] of entries.slice(1)) {
    withoutOlderImages[model] = {
      messages: stripMessageImages(conversation.messages),
      updatedAt: conversation.updatedAt,
    }
  }

  try {
    writeStoredValue(
      STORAGE_KEYS.CONVERSATIONS,
      conversationsSchema.parse(withoutOlderImages)
    )
    return
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save conversations without older images:', error)
  }

  try {
    writeStoredValue(
      STORAGE_KEYS.CONVERSATIONS,
      conversationsSchema.parse({
        [newestModel]: {
          messages: stripMessageImages(newest.messages),
          updatedAt: newest.updatedAt,
        },
      })
    )
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save the active conversation:', error)
  }
}

/**
 * Clear all playground data
 */
export function clearPlaygroundData(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.CONFIG)
    localStorage.removeItem(STORAGE_KEYS.CONVERSATIONS)
    localStorage.removeItem(STORAGE_KEYS.LEGACY_MESSAGES)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to clear playground data:', error)
  }
}
