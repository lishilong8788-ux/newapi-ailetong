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

import type { CopilotSession } from '../types'

export interface CopilotDeleteDialogProps {
  session: CopilotSession | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isDeleting: boolean
}

export function CopilotDeleteDialog(props: CopilotDeleteDialogProps) {
  const { t } = useTranslation()

  return (
    <ConfirmDialog
      open={props.session !== null}
      onOpenChange={props.onOpenChange}
      title={t('Delete this conversation?')}
      desc={
        <p>
          {t('This will permanently delete')}{' '}
          <span className='font-semibold'>
            {props.session?.title || t('Untitled conversation')}
          </span>
          {t('. This action cannot be undone.')}
        </p>
      }
      confirmText={props.isDeleting ? t('Deleting...') : t('Delete')}
      destructive
      isLoading={props.isDeleting}
      handleConfirm={props.onConfirm}
    />
  )
}
