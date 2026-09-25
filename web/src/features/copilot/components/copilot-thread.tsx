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
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Skeleton } from '@/components/ui/skeleton'

import { COPILOT_EXAMPLE_PROMPTS } from '../constants'
import type { CopilotTurn } from '../types'
import { CopilotTurnView } from './copilot-turn'

export interface CopilotThreadProps {
  turns: CopilotTurn[]
  isLoading: boolean
  isStreaming: boolean
  onPickExample: (prompt: string) => void
}

export function CopilotThread(props: CopilotThreadProps) {
  const { t } = useTranslation()

  if (props.isLoading && props.turns.length === 0) {
    return (
      <div className='flex flex-1 flex-col gap-3 p-4'>
        <Skeleton className='h-6 w-1/3 rounded-md' />
        <Skeleton className='h-20 rounded-lg' />
        <Skeleton className='h-14 rounded-lg' />
      </div>
    )
  }

  if (props.turns.length === 0) {
    return <CopilotEmptyState onPickExample={props.onPickExample} />
  }

  return (
    <Conversation className='flex-1'>
      <ConversationContent className='mx-auto flex w-full max-w-3xl flex-col gap-5 p-4'>
        {/* Polite rather than assertive: a reply lands in whole chunks while the
            reader may be mid-sentence in another part of the page, and an
            assertive region would interrupt them for every chunk. */}
        <div
          aria-live='polite'
          aria-busy={props.isStreaming}
          className='flex flex-col gap-5'
        >
          {props.turns.map((turn) => (
            <CopilotTurnView key={turn.id} turn={turn} />
          ))}
        </div>
      </ConversationContent>
      <ConversationScrollButton aria-label={t('Scroll to latest')} />
    </Conversation>
  )
}

function CopilotEmptyState(props: { onPickExample: (prompt: string) => void }) {
  const { t } = useTranslation()

  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center'>
      <div className='bg-muted flex size-10 items-center justify-center rounded-xl'>
        <Bot aria-hidden='true' className='text-muted-foreground size-5' />
      </div>
      <div className='space-y-1'>
        <h3 className='text-sm font-medium'>
          {t('Ask about margin, cost and pricing')}
        </h3>
        <p className='text-muted-foreground max-w-md text-xs'>
          {t(
            'The copilot reads this install through the same queries the ledger pages use, and shows every step it ran.'
          )}
        </p>
      </div>

      <div className='flex w-full max-w-md flex-col gap-1.5'>
        {COPILOT_EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type='button'
            onClick={() => props.onPickExample(t(prompt))}
            className='bg-card hover:bg-accent/50 focus-visible:ring-ring/50 rounded-lg border px-3 py-2 text-left text-xs transition-colors outline-none focus-visible:ring-3'
          >
            {t(prompt)}
          </button>
        ))}
      </div>
    </div>
  )
}
