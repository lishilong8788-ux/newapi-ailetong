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
import { Check, ChevronRight, Database, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import { formatToolArgs, formatToolDuration, getToolLabelKey } from '../lib'
import type { CopilotToolBlock } from '../types'

/**
 * One tool call, as a step row.
 *
 * This row is the feature's audit trail: it is how an admin tells a figure the
 * copilot read out of the system from one it wrote out of the model. So the name,
 * the outcome and the duration are always on screen, and only the arguments hide
 * behind the disclosure — collapsed by default because a turn can run several
 * steps and the JSON would bury the answer.
 *
 * Hand-rolled rather than the `ai-elements` `Tool`: that component keys its
 * states off the `ai` package's `ToolUIPart` vocabulary and has no place for a
 * duration, which is half of what makes this row evidence.
 */
export function CopilotToolStep(props: { block: CopilotToolBlock }) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const { block } = props
  const duration = formatToolDuration(block.durationMs)
  const panelId = `copilot-tool-args-${block.id}`

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border text-sm',
        block.status === 'error'
          ? 'border-destructive/30 bg-destructive/5'
          : 'bg-muted/40'
      )}
    >
      <button
        type='button'
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className='focus-visible:ring-ring/50 flex w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none focus-visible:ring-3'
      >
        <ChevronRight
          aria-hidden='true'
          className={cn(
            'text-muted-foreground size-3.5 shrink-0 transition-transform',
            isOpen && 'rotate-90'
          )}
        />
        <Database
          aria-hidden='true'
          className='text-muted-foreground size-3.5 shrink-0'
        />
        <span className='truncate text-xs font-medium'>
          {t(getToolLabelKey(block.toolName))}
        </span>

        <span className='ml-auto flex shrink-0 items-center gap-1.5'>
          {duration && (
            <span className='text-muted-foreground text-[11px] tabular-nums'>
              {duration}
            </span>
          )}
          <CopilotToolStatusIcon status={block.status} />
        </span>
      </button>

      {isOpen && (
        <div id={panelId} className='border-t px-2.5 py-2'>
          <p className='text-muted-foreground mb-1 text-[11px] font-medium'>
            {t('Arguments')}
          </p>
          <pre className='bg-background text-muted-foreground max-h-56 overflow-auto rounded-md border p-2 text-[11px] leading-relaxed whitespace-pre-wrap'>
            {formatToolArgs(block.args)}
          </pre>
        </div>
      )}

      {block.status === 'error' && block.errorText && (
        <p className='text-destructive border-t px-2.5 py-1.5 text-xs'>
          {block.errorText}
        </p>
      )}
    </div>
  )
}

function CopilotToolStatusIcon(props: { status: CopilotToolBlock['status'] }) {
  const { t } = useTranslation()

  if (props.status === 'running') {
    return <Spinner className='size-3.5' aria-label={t('Running')} />
  }

  if (props.status === 'error') {
    return (
      <TriangleAlert
        className='text-destructive size-3.5'
        role='img'
        aria-label={t('Failed')}
      />
    )
  }

  return (
    <Check
      className='text-success size-3.5'
      role='img'
      aria-label={t('Done')}
    />
  )
}
