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
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

import { COPILOT_EXAMPLE_PROMPTS } from '../constants'
import type { CopilotSession } from '../types'

export interface CopilotRailProps {
  sessions: CopilotSession[]
  isLoading: boolean
  activeSessionId: number | null
  onSelectSession: (id: number) => void
  onDeleteSession: (session: CopilotSession) => void
  onNewSession: () => void
  onPickExample: (prompt: string) => void
  className?: string
}

/**
 * The rail: new conversation, the mode switch, seed prompts, then history.
 *
 * Seed prompts sit above the history rather than in the thread alone because they
 * are also the feature's documentation — an admin who has forgotten what it can
 * answer reads them without clearing the pane they are looking at.
 */
export function CopilotRail(props: CopilotRailProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return (
    <aside
      className={cn(
        'bg-card flex min-h-0 flex-col gap-3 rounded-xl border p-3',
        props.className
      )}
    >
      <Button className='w-full justify-center' onClick={props.onNewSession}>
        <Plus aria-hidden='true' />
        {t('New conversation')}
      </Button>

      <CopilotModeTabs />

      <div className='flex flex-col gap-1.5'>
        <p className='text-muted-foreground px-0.5 text-xs font-medium'>
          {t('Example prompts')}
        </p>
        {COPILOT_EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type='button'
            onClick={() => props.onPickExample(t(prompt))}
            className='text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:ring-ring/50 rounded-md px-2 py-1.5 text-left text-xs transition-colors outline-none focus-visible:ring-3'
          >
            {t(prompt)}
          </button>
        ))}
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-1.5'>
        <p className='text-muted-foreground px-0.5 text-xs font-medium'>
          {t('History')}
        </p>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {props.isLoading && (
            <div className='flex flex-col gap-1.5'>
              <Skeleton className='h-9 rounded-md' />
              <Skeleton className='h-9 rounded-md' />
              <Skeleton className='h-9 rounded-md' />
            </div>
          )}

          {!props.isLoading && props.sessions.length === 0 && (
            <p className='text-muted-foreground px-0.5 py-1 text-xs'>
              {t('No conversations yet.')}
            </p>
          )}

          <ul className='flex flex-col gap-0.5'>
            {props.sessions.map((session) => (
              <li key={session.id} className='group/session relative'>
                <button
                  type='button'
                  onClick={() => props.onSelectSession(session.id)}
                  aria-current={
                    session.id === props.activeSessionId ? 'true' : undefined
                  }
                  className={cn(
                    'focus-visible:ring-ring/50 flex w-full flex-col items-start gap-0.5 rounded-md py-1.5 pr-8 pl-2 text-left outline-none transition-colors focus-visible:ring-3',
                    session.id === props.activeSessionId
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <span className='w-full truncate text-xs font-medium'>
                    {session.title || t('Untitled conversation')}
                  </span>
                  <span className='text-muted-foreground text-[11px]'>
                    {formatTimestampRelative(
                      session.updated_time || session.created_time,
                      'seconds',
                      // Must go through toIntlLocale: this project's i18next codes
                      // are `zhCN`/`zhTW`, which are not valid BCP-47 tags, and
                      // Intl.RelativeTimeFormat throws RangeError on them — taking
                      // the whole page down with it, since the throw is in render.
                      locale
                    )}
                  </span>
                </button>

                {/* Kept in the DOM at all times and only made visible on
                    hover/focus: rendering it conditionally on hover would put it
                    out of reach of the keyboard entirely. */}
                <Button
                  variant='ghost'
                  size='icon-xs'
                  aria-label={t('Delete conversation')}
                  onClick={() => props.onDeleteSession(session)}
                  className='text-muted-foreground hover:text-destructive absolute top-1.5 right-1 opacity-0 transition-opacity group-hover/session:opacity-100 focus-visible:opacity-100'
                >
                  <Trash2 aria-hidden='true' />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  )
}

/**
 * Q&A / Smart actions.
 *
 * Smart actions is phase 2 and is rendered disabled rather than hidden: the shape
 * of the feature is the point — an admin should be able to see that asking and
 * acting are two different modes, and that only one of them is live.
 */
function CopilotModeTabs() {
  const { t } = useTranslation()

  return (
    <Tabs value='qa' className='w-full'>
      <TabsList className='w-full' aria-label={t('Copilot mode')}>
        <TabsTrigger value='qa' className='flex-1 text-xs'>
          {t('Q&A')}
        </TabsTrigger>
        <TabsTrigger
          value='actions'
          disabled
          title={t('Coming soon')}
          className='flex-1 gap-1 text-xs'
        >
          <Sparkles aria-hidden='true' className='size-3' />
          {t('Smart actions')}
        </TabsTrigger>
      </TabsList>
      <p className='text-muted-foreground px-0.5 text-[11px]'>
        {t('Smart actions are coming soon. Q&A is read-only.')}
      </p>
    </Tabs>
  )
}
