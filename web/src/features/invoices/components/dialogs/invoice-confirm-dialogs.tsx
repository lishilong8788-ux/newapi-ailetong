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

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface CancelInvoiceRequestDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cancelling: boolean
  onConfirm: () => void
}

/** Withdrawing a pending request returns its orders to the pending tab. */
export function CancelInvoiceRequestDialog(
  props: CancelInvoiceRequestDialogProps
) {
  const { t } = useTranslation()

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('Withdraw Invoice Request')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              'The linked orders will return to the pending invoicing list. Continue?'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.cancelling}>
            {t('Cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={props.onConfirm}
            disabled={props.cancelling}
          >
            {props.cancelling ? t('Processing...') : t('Confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface DeleteInvoiceProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profileTitle: string
  deleting: boolean
  onConfirm: () => void
}

export function DeleteInvoiceProfileDialog(
  props: DeleteInvoiceProfileDialogProps
) {
  const { t } = useTranslation()

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('Delete Invoice Title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('Delete "{{title}}"? This action cannot be undone.', {
              title: props.profileTitle,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.deleting}>
            {t('Cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={props.onConfirm}
            disabled={props.deleting}
          >
            {props.deleting ? t('Processing...') : t('Confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
