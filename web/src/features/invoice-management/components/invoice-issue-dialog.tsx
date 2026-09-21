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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

import { getInvoiceRequest, issueInvoiceRequest } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import { toIssueInvoicePayload, type IssueInvoiceFormValues } from '../lib'
import { InvoiceAttachmentField } from './invoice-attachment-field'
import { InvoiceCopySheet } from './invoice-copy-sheet'
import { InvoiceIssueForm } from './invoice-issue-form'
import { useInvoices } from './invoices-provider'

const ISSUE_FORM_ID = 'invoice-issue-form'

export function InvoiceIssueDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useInvoices()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const requestId = currentRow?.id
  const isOpen = open === 'issue' && requestId !== undefined
  const detailQueryKey = ['invoice-request-detail', requestId]

  // Per-order amounts live in `invoice_items`, which the list endpoint does not
  // return. Fetched here rather than per row: a merged invoice is the only case
  // that needs them, and the operator is already committed to this request.
  const { data: detail, isLoading: isLoadingItems } = useQuery({
    queryKey: detailQueryKey,
    queryFn: async () => {
      if (requestId === undefined) return null
      const result = await getInvoiceRequest(requestId)
      return result.success ? (result.data ?? null) : null
    },
    enabled: isOpen,
    staleTime: 30_000,
  })

  if (!isOpen || !currentRow) return null

  const attachments = detail?.attachments ?? []

  const handleSubmit = async (values: IssueInvoiceFormValues) => {
    // An invoice must ship with something the customer can open. The rule spans
    // the upload slot and the link field, so neither field's own schema can own
    // it; the server enforces the same condition.
    if (attachments.length === 0 && values.pdf_url.trim() === '') {
      toast.error(t(ERROR_MESSAGES.DOCUMENT_REQUIRED))
      return
    }

    setIsSubmitting(true)
    try {
      const result = await issueInvoiceRequest(
        currentRow.id,
        toIssueInvoicePayload(values)
      )
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.ISSUE_FAILED))
        return
      }
      toast.success(t(SUCCESS_MESSAGES.INVOICE_ISSUED))
      triggerRefresh()
      setOpen(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => !isOpen && setOpen(null)}
      title={t('Issue Invoice')}
      description={t(
        'Copy the details into your invoicing software, then record the invoice number and upload the invoice file here.'
      )}
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => setOpen(null)}
            disabled={isSubmitting}
          >
            {t('Cancel')}
          </Button>
          <Button form={ISSUE_FORM_ID} type='submit' disabled={isSubmitting}>
            {isSubmitting ? t('Processing...') : t('Issue Invoice')}
          </Button>
        </>
      }
    >
      <InvoiceCopySheet
        request={currentRow}
        items={detail?.items}
        isLoadingItems={isLoadingItems}
      />
      <Separator />
      <InvoiceIssueForm
        key={currentRow.id}
        formId={ISSUE_FORM_ID}
        recipientEmail={currentRow.recipient_email}
        isSubmitting={isSubmitting}
        attachmentSlot={
          <InvoiceAttachmentField
            requestId={currentRow.id}
            attachments={attachments}
            disabled={isSubmitting}
            onChanged={() =>
              void queryClient.invalidateQueries({ queryKey: detailQueryKey })
            }
          />
        }
        onSubmit={handleSubmit}
      />
    </Dialog>
  )
}
