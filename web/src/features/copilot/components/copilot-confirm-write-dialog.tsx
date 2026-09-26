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
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'

import { formatToolArgs, getToolLabelKey, toToolArgEntries } from '../lib'
import type { CopilotPendingWrite } from '../types'

export interface CopilotConfirmWriteDialogProps {
  pendingWrite: CopilotPendingWrite | null
  onApprove: () => void
  onDecline: () => void
}

/**
 * The per-write confirmation. Every write the copilot proposes passes through
 * here — not only the ones that look dangerous.
 *
 * The arguments are listed one row per field, verbatim, rather than summarised
 * into a sentence. A summary is a second description of the change that can drift
 * from the payload actually being sent, and the operator would be approving the
 * sentence while the server executes the payload. What is on screen here is what
 * the tool receives.
 */
export function CopilotConfirmWriteDialog(
  props: CopilotConfirmWriteDialogProps
) {
  const { t } = useTranslation()
  const pendingWrite = props.pendingWrite
  const entries = pendingWrite ? toToolArgEntries(pendingWrite.args) : null

  return (
    <ConfirmDialog
      open={pendingWrite !== null}
      // Dismissing by overlay or Escape is a refusal, not a deferral: leaving the
      // proposal open with no dialog on screen would strand the turn in a state
      // whose only exit is off screen.
      onOpenChange={(open) => !open && props.onDecline()}
      title={t('Approve this change?')}
      desc={
        <p>
          {t(
            'The copilot wants to write to this install. Nothing has changed yet — review the exact values below.'
          )}
        </p>
      }
      cancelBtnText={t('Do not write')}
      confirmText={t('Approve and run')}
      handleConfirm={props.onApprove}
    >
      {pendingWrite && (
        <div className='flex flex-col gap-2 text-sm'>
          <div className='flex items-baseline gap-2'>
            <span className='text-muted-foreground shrink-0 text-xs'>
              {t('Action')}
            </span>
            <span className='font-medium'>
              {t(getToolLabelKey(pendingWrite.toolName))}
            </span>
          </div>

          <div className='overflow-hidden rounded-lg border'>
            {entries === null ? (
              // Not the expected object shape. The literal payload goes on screen
              // unchanged — an argument list that cannot be read as fields is
              // exactly when the operator needs to see the raw bytes.
              <pre className='bg-muted/40 max-h-56 overflow-auto p-2 text-[11px] leading-relaxed whitespace-pre-wrap'>
                {formatToolArgs(pendingWrite.args)}
              </pre>
            ) : entries.length === 0 ? (
              <p className='text-muted-foreground p-2 text-xs'>
                {t('This call takes no arguments.')}
              </p>
            ) : (
              <dl className='divide-y'>
                {entries.map((entry) => (
                  <div
                    key={entry.name}
                    className='grid grid-cols-[minmax(0,10rem)_1fr] gap-2 px-2 py-1.5'
                  >
                    <dt className='text-muted-foreground truncate font-mono text-[11px]'>
                      {entry.name}
                    </dt>
                    <dd className='font-mono text-[11px] break-all'>
                      {entry.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <p className='text-muted-foreground text-[11px]'>
            {t(
              'Approving re-runs this turn with just this one call allowed. Anything else it asks for will stop here again.'
            )}
          </p>
        </div>
      )}
    </ConfirmDialog>
  )
}
