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
import { DatabaseZapIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/**
 * Where the transcript lives — reachable at any point in the conversation.
 *
 * This started as three lines of grey text in the empty state, which was wrong
 * twice over. It rendered beside the model description rather than under it, so
 * it sat in the middle of the reading path; and the empty state disappears on
 * the first message, so the note was gone exactly when someone would think to
 * ask. The people who need this are mid-conversation, wondering where their
 * messages went.
 *
 * So: an icon that is always in the composer footer, with the detail one click
 * away. Costs one glyph of permanent space, stays out of the reading path, and
 * survives the whole session.
 *
 * A popover rather than a tooltip because the content is three sentences, and
 * because click beats hover for something a touch user should also reach.
 */
export function StorageNote() {
  const { t } = useTranslation()

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label={t('Data storage')}
            className='text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/60 focus-visible:ring-ring/50 inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2'
            type='button'
          />
        }
      >
        <DatabaseZapIcon className='size-3.5' aria-hidden='true' />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[19rem] max-w-[calc(100vw-2rem)] p-3'
        collisionPadding={8}
        side='top'
        sideOffset={8}
      >
        {/*
         * Plain statements of where the data goes. No metaphors, no reassurance.
         *
         * Two earlier drafts missed in opposite directions: the first recited
         * system rules ("the server stores none of them", "switching browsers
         * loses them") and read as a disclaimer; the second led with a promise
         * ("these conversations are yours alone", "a scratchpad, not an
         * archive") and read as marketing. This is a technical note in a
         * developer console — it should read like documentation.
         *
         * The billing line stays. Without it the first two read as "nothing is
         * recorded", which is false: the relay path deducts quota and writes a
         * consume log exactly as for any API call. What that log holds is the
         * cost — `Content` is billing ratios ("模型倍率 x，分组倍率 y", see
         * `service/quota.go`), never the prompt or the reply — so the
         * distinction is content vs. cost, and it is worth one clause.
         */}
        <div className='grid gap-1.5'>
          <div className='text-sm font-semibold'>{t('Data storage')}</div>
          <p className='text-muted-foreground text-xs leading-5'>
            {t(
              'Conversations are stored in this browser (localStorage) and are not sent to the server.'
            )}
          </p>
          <p className='text-muted-foreground text-xs leading-5'>
            {t(
              'Another browser or device shows nothing; clearing site data deletes them.'
            )}
          </p>
          <p className='text-muted-foreground text-xs leading-5'>
            {t(
              'Requests are billed and recorded in the usage log as usual. The log holds the cost, not the conversation.'
            )}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
