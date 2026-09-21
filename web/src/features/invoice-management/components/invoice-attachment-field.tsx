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
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

import {
  deleteInvoiceAttachment,
  invoiceAttachmentDownloadUrl,
  uploadInvoiceAttachment,
} from '../api'
import { ERROR_MESSAGES, INVOICE_ATTACHMENT, SUCCESS_MESSAGES } from '../constants'
import { formatAttachmentSize } from '../lib'
import type { InvoiceAttachment } from '../types'

const BYTES_PER_MIB = 1024 * 1024

type InvoiceAttachmentFieldProps = {
  requestId: number
  attachments: InvoiceAttachment[]
  disabled: boolean
  onChanged: () => void
}

/**
 * Upload slot for the invoice document. The files listed here are what the
 * customer receives as email attachments, so each one is downloadable from the
 * dialog: the operator can verify the exact file before issuing.
 *
 * Uploads land immediately rather than on submit. The server needs a request to
 * attach them to, and a file that vanished because the operator closed the dialog
 * would be worse than one that has to be deleted.
 */
export function InvoiceAttachmentField(props: InvoiceAttachmentFieldProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isBusy, setIsBusy] = useState(false)

  const totalBytes = props.attachments.reduce(
    (sum, attachment) => sum + attachment.file_size,
    0
  )
  const isFull = props.attachments.length >= INVOICE_ATTACHMENT.MAX_FILES
  const isDisabled = props.disabled || isBusy

  // Checked here as well as on the server so the operator is told before a
  // 10 MB upload is spent.
  const rejectLocally = (file: File): string | null => {
    if (file.size > INVOICE_ATTACHMENT.MAX_FILE_BYTES) {
      return t(ERROR_MESSAGES.ATTACHMENT_TOO_LARGE, {
        max: INVOICE_ATTACHMENT.MAX_FILE_BYTES / BYTES_PER_MIB,
      })
    }
    if (totalBytes + file.size > INVOICE_ATTACHMENT.MAX_TOTAL_BYTES) {
      return t(ERROR_MESSAGES.ATTACHMENT_TOTAL_TOO_LARGE, {
        max: INVOICE_ATTACHMENT.MAX_TOTAL_BYTES / BYTES_PER_MIB,
      })
    }
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!INVOICE_ATTACHMENT.ACCEPT.split(',').includes(extension)) {
      return t(ERROR_MESSAGES.ATTACHMENT_TYPE_UNSUPPORTED)
    }
    return null
  }

  const handleSelected = async (file: File | undefined) => {
    if (!file) return
    const localError = rejectLocally(file)
    if (localError) {
      toast.error(localError)
      return
    }

    setIsBusy(true)
    try {
      const result = await uploadInvoiceAttachment(props.requestId, file)
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.ATTACHMENT_UPLOAD_FAILED))
        return
      }
      toast.success(t(SUCCESS_MESSAGES.ATTACHMENT_UPLOADED))
      props.onChanged()
    } finally {
      setIsBusy(false)
      // Cleared so re-picking the same file after a failure still fires change.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleDelete = async (attachmentId: number) => {
    setIsBusy(true)
    try {
      const result = await deleteInvoiceAttachment(props.requestId, attachmentId)
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.ATTACHMENT_DELETE_FAILED))
        return
      }
      toast.success(t(SUCCESS_MESSAGES.ATTACHMENT_DELETED))
      props.onChanged()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className='space-y-2'>
      <Label>{t('Invoice File')}</Label>

      {props.attachments.length > 0 && (
        <ul className='space-y-1.5'>
          {props.attachments.map((attachment) => (
            <li
              key={attachment.id}
              className='bg-muted/40 flex items-center gap-2 rounded-md border px-2.5 py-1.5'
            >
              <FileText
                className='text-muted-foreground h-4 w-4 shrink-0'
                aria-hidden='true'
              />
              <span className='min-w-0 flex-1 truncate text-sm'>
                {attachment.file_name}
              </span>
              <span className='text-muted-foreground shrink-0 font-mono text-xs'>
                {formatAttachmentSize(attachment.file_size)}
              </span>
              {/* An anchor, not a Button: this navigates to a download URL, and
                  the Button here has no asChild escape hatch. */}
              <a
                href={invoiceAttachmentDownloadUrl(
                  props.requestId,
                  attachment.id
                )}
                target='_blank'
                rel='noreferrer'
                aria-label={t('Download')}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'icon' }),
                  'h-7 w-7 shrink-0'
                )}
              >
                <Download className='h-3.5 w-3.5' aria-hidden='true' />
              </a>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='text-destructive h-7 w-7 shrink-0'
                disabled={isDisabled}
                aria-label={t('Remove')}
                onClick={() => handleDelete(attachment.id)}
              >
                <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type='file'
        className='hidden'
        accept={INVOICE_ATTACHMENT.ACCEPT}
        onChange={(event) => void handleSelected(event.target.files?.[0])}
      />
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={isDisabled || isFull}
        onClick={() => inputRef.current?.click()}
      >
        {isBusy ? (
          <Upload className='h-3.5 w-3.5 animate-pulse' aria-hidden='true' />
        ) : (
          <Paperclip className='h-3.5 w-3.5' aria-hidden='true' />
        )}
        {isBusy ? t('Uploading...') : t('Upload Invoice File')}
      </Button>

      <p className='text-muted-foreground text-xs'>
        {t(
          'PDF, OFD, JPG or PNG. Up to {{count}} files, {{size}} MB each. The customer receives them as email attachments.',
          {
            count: INVOICE_ATTACHMENT.MAX_FILES,
            size: INVOICE_ATTACHMENT.MAX_FILE_BYTES / BYTES_PER_MIB,
          }
        )}
      </p>
    </div>
  )
}
