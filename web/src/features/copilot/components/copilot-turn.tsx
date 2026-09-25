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
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Response } from '@/components/ai-elements/response'
import { Spinner } from '@/components/ui/spinner'

import type {
  CopilotAssistantTurn,
  CopilotBlock,
  CopilotToolBlock,
  CopilotTurn,
} from '../types'
import { CopilotToolStep } from './copilot-tool-step'
import { CopilotTurnImages } from './copilot-turn-images'

export function CopilotTurnView(props: { turn: CopilotTurn }) {
  if (props.turn.role === 'user') {
    const images = props.turn.images ?? []
    return (
      <div className='flex flex-col items-end gap-1.5'>
        {images.length > 0 && <CopilotTurnImages images={images} />}
        {/* An image-only turn renders no bubble: an empty grey pill under the
            screenshot reads as a message that failed to send. */}
        {props.turn.text.trim().length > 0 && (
          <div className='bg-secondary text-foreground max-w-[85%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap'>
            {props.turn.text}
          </div>
        )}
      </div>
    )
  }

  return <CopilotAssistantTurnView turn={props.turn} />
}

/**
 * One assistant turn: its blocks in arrival order, with runs of tool steps boxed
 * together.
 *
 * Grouping consecutive steps into one card is what makes a multi-tool turn read as
 * a single unit of work instead of four loose rows — and because the grouping
 * follows arrival order, the narration between two groups stays between them.
 */
function CopilotAssistantTurnView(props: { turn: CopilotAssistantTurn }) {
  const { t } = useTranslation()
  const groups = groupBlocks(props.turn.blocks)
  const isStreaming = props.turn.status === 'streaming'

  return (
    <div className='flex flex-col gap-2.5'>
      {groups.map((group) =>
        group.kind === 'text' ? (
          <div
            key={group.id}
            className='text-foreground text-sm leading-relaxed'
          >
            {/* Distinct parser id per block: the markdown parser caches by id,
                and a transcript holds many blocks at once. */}
            <Response
              final={!isStreaming}
              parserId={`copilot-${props.turn.id}-${group.id}`}
            >
              {group.text}
            </Response>
          </div>
        ) : (
          <section
            key={group.id}
            aria-label={t('Steps the copilot ran')}
            className='bg-card flex flex-col gap-1.5 rounded-xl border p-2'
          >
            {group.steps.map((step) => (
              <CopilotToolStep key={step.id} block={step} />
            ))}
          </section>
        )
      )}

      {isStreaming && (
        <p className='text-muted-foreground flex items-center gap-2 text-xs'>
          <Spinner className='size-3.5' />
          {t('Working...')}
        </p>
      )}

      {props.turn.status === 'error' && props.turn.errorText && (
        <p className='text-destructive flex items-start gap-1.5 text-xs'>
          <TriangleAlert
            aria-hidden='true'
            className='mt-0.5 size-3.5 shrink-0'
          />
          {props.turn.errorText}
        </p>
      )}

      {props.turn.usage && (
        <p className='text-muted-foreground text-[11px] tabular-nums'>
          {t('{{prompt}} prompt + {{completion}} completion tokens', {
            prompt: props.turn.usage.promptTokens,
            completion: props.turn.usage.completionTokens,
          })}
        </p>
      )}
    </div>
  )
}

type BlockGroup =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tools'; id: string; steps: CopilotToolBlock[] }

function groupBlocks(blocks: CopilotBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = []

  for (const block of blocks) {
    if (block.kind === 'text') {
      groups.push({ kind: 'text', id: block.id, text: block.text })
      continue
    }

    const last = groups.at(-1)
    if (last?.kind === 'tools') {
      last.steps.push(block)
      continue
    }
    groups.push({ kind: 'tools', id: `tools-${block.id}`, steps: [block] })
  }

  return groups
}
