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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Loader } from '@/components/ai-elements/loader'
import { MessageContent } from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Response } from '@/components/ai-elements/response'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources'
import { cn } from '@/lib/utils'

import { MESSAGE_STATUS } from '../../constants'
import {
  getMessageAlignmentClass,
  getMessageContentState,
  isErrorMessage,
  type MessageAlignment,
} from '../../lib'
import { getMessageContentStyles } from '../../lib/message/message-styles'
import type { Message } from '../../types'
import { MessageError } from './message-error'
import { MessageImages } from './message-images'
import { MessageVideos } from './message-videos'
import { MessageMetadata } from './message-metadata'

type PlaygroundMessageContentProps = {
  actions: ReactNode
  alignment: MessageAlignment
  errorActions?: ReactNode
  isSourceVisible?: boolean
  message: Message
  versionContent: string
}

export function PlaygroundMessageContent({
  actions,
  alignment,
  errorActions,
  isSourceVisible = false,
  message,
  versionContent,
}: PlaygroundMessageContentProps) {
  const { t } = useTranslation()
  const {
    displayContent,
    hasReasoning,
    hasSources,
    images,
    reasoningContent,
    showLoader,
    showMessageContent,
    showMessageImages,
    sources,
  } = getMessageContentState(message, versionContent)
  const isError = isErrorMessage(message)
  const isMessageFinal =
    message.status !== MESSAGE_STATUS.LOADING &&
    message.status !== MESSAGE_STATUS.STREAMING

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col',
        getMessageAlignmentClass(alignment)
      )}
    >
      {hasSources && (
        <Sources>
          <SourcesTrigger count={sources.length} />
          <SourcesContent>
            {sources.map((source) => (
              <Source
                href={source.href}
                key={`${source.href}-${source.title}`}
                title={source.title}
              />
            ))}
          </SourcesContent>
        </Sources>
      )}

      {hasReasoning && (
        <Reasoning
          defaultOpen
          duration={message.reasoning?.duration}
          isStreaming={message.isReasoningStreaming}
        >
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      )}

      {showLoader && (
        <div className='flex flex-col gap-2 py-2'>
          <div className='flex items-center gap-2'>
            <Loader />
            <Shimmer className='text-sm' duration={1}>
              {/* A video runs for minutes, so "Responding..." would read as a
                  hang. Naming the wait is what makes it legible. */}
              {message.isTaskPending
                ? t('Generating video. This takes a few minutes...')
                : t('Responding...')}
            </Shimmer>
          </div>

          {/* Only when the platform actually reports progress: a bar stuck at 0
              for two minutes is worse than no bar, since it looks broken rather
              than merely slow. */}
          {message.taskProgress !== undefined && (
            <div className='flex items-center gap-2'>
              <div
                aria-label={t('Generation progress')}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={message.taskProgress}
                className='bg-muted h-1.5 w-full max-w-60 overflow-hidden rounded-full'
                role='progressbar'
              >
                <div
                  className='bg-primary h-full rounded-full transition-[width] duration-500'
                  style={{ width: `${message.taskProgress}%` }}
                />
              </div>
              <span className='text-muted-foreground text-[11px] tabular-nums'>
                {message.taskProgress}%
              </span>
            </div>
          )}
        </div>
      )}

      {isError && (
        <>
          <MessageError message={message} className='mb-2' />
          <MessageMetadata alignment={alignment} message={message} />
          {errorActions}
        </>
      )}

      {!isError && showMessageImages && (
        <MessageImages className='mb-2' images={images} />
      )}

      {/* Generated images, reusing the attachment grid rather than a second
          component: both render "a row of images belonging to this message", and
          the only difference is which side produced them. */}
      {!isError && message.results && message.results.length > 0 && (
        <MessageImages className='mb-2' images={message.results} />
      )}

      {!isError && message.videos && message.videos.length > 0 && (
        <MessageVideos className='mb-2' videos={message.videos} />
      )}

      {!isError && (showMessageContent || showMessageImages) && (
        <>
          {showMessageContent && isSourceVisible && (
            <CodeBlock
              code={versionContent}
              className='my-0 group-[.is-assistant]:w-full group-[.is-assistant]:max-w-[78ch]'
              collapsedLines={24}
              defaultCollapsed={false}
              language='markdown'
              maxExpandedLines={48}
              showLineNumbers
              showToolbar
              title={t('Raw response')}
            >
              <CodeBlockCopyButton />
            </CodeBlock>
          )}

          {showMessageContent && !isSourceVisible && (
            <MessageContent
              variant='flat'
              className={cn(getMessageContentStyles())}
            >
              <Response final={isMessageFinal}>{displayContent}</Response>
            </MessageContent>
          )}
          <MessageMetadata alignment={alignment} message={message} />
          {actions}
        </>
      )}
    </div>
  )
}
