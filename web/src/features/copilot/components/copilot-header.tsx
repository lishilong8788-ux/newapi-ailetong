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
import { Link } from '@tanstack/react-router'
import { Bot, Plus, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { COPILOT_SETTINGS_SECTION, COPILOT_SETTINGS_URL } from '../constants'

/**
 * Thread header: who is answering.
 *
 * The model used to be badged here. It now lives in the composer's picker, which
 * both states it and changes it — two read-only copies of the same fact on one
 * screen is how they end up disagreeing.
 */
export function CopilotHeader(props: { onNewSession: () => void }) {
  const { t } = useTranslation()

  return (
    <header className='flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5'>
      <div className='flex min-w-0 items-center gap-2'>
        <Bot aria-hidden='true' className='text-muted-foreground size-4' />
        <h2 className='truncate text-sm font-semibold'>{t('Ops Copilot')}</h2>
      </div>

      {/* Only below `lg`, where the rail is hidden and this is the sole way to
          start over. Duplicating the rail's primary button at wider widths would
          put two of them on screen. */}
      <Button
        variant='outline'
        size='icon-sm'
        onClick={props.onNewSession}
        aria-label={t('New conversation')}
        className='shrink-0 lg:hidden'
      >
        <Plus aria-hidden='true' />
      </Button>
    </header>
  )
}

/**
 * Shown when `/status` reports the feature off or unconfigured.
 *
 * Points at the picker below rather than at the settings page, because that is now
 * the shorter path and the one already on screen. The settings link stays as a
 * secondary route for an operator who wants the rest of the options (turn limit),
 * and it names the copilot's own section — linking to the page's first tab landed
 * on two unrelated JSON editors.
 *
 * The two states are told apart on purpose: "off" and "no model chosen" need
 * different actions, and a single sentence covering both sends half its readers to
 * the wrong control.
 */
export function CopilotNotConfiguredNotice(props: {
  hasModel: boolean
  canConfigure: boolean
}) {
  const { t } = useTranslation()

  return (
    <Alert className='mx-4 mt-3 w-auto'>
      <TriangleAlert aria-hidden='true' />
      <AlertDescription>
        <p>{t(noticeTextKey(props.hasModel, props.canConfigure))}</p>
        <Link
          to={COPILOT_SETTINGS_URL}
          params={{ section: COPILOT_SETTINGS_SECTION }}
          className='text-primary text-xs underline underline-offset-4'
        >
          {t('Open copilot settings')}
        </Link>
      </AlertDescription>
    </Alert>
  )
}

function noticeTextKey(hasModel: boolean, canConfigure: boolean): string {
  if (!canConfigure) {
    return 'The ops copilot is not configured yet. Ask the site owner to turn it on and pick a model.'
  }
  if (hasModel) {
    return 'A model is selected but the copilot is switched off. Turn it on in the picker below the message box.'
  }
  return 'The ops copilot is not configured yet. Pick a model and turn it on in the picker below the message box.'
}
