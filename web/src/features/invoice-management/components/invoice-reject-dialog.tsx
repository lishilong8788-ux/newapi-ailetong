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
import { zodResolver } from '@hookform/resolvers/zod'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'

import { rejectInvoiceRequest } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  getRejectInvoiceFormSchema,
  parseTradeNumbers,
  REJECT_INVOICE_FORM_DEFAULTS,
  toRejectInvoicePayload,
  type RejectInvoiceFormValues,
} from '../lib'
import { useInvoices } from './invoices-provider'

const REJECT_FORM_ID = 'invoice-reject-form'

export function InvoiceRejectDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useInvoices()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const schema = getRejectInvoiceFormSchema(t)
  const form = useForm<RejectInvoiceFormValues>({
    resolver: zodResolver(
      schema
    ) as unknown as Resolver<RejectInvoiceFormValues>,
    defaultValues: REJECT_INVOICE_FORM_DEFAULTS,
  })

  if (open !== 'reject' || !currentRow) return null

  const orderCount = parseTradeNumbers(currentRow.trade_no_snapshot).length

  const closeDialog = () => {
    form.reset(REJECT_INVOICE_FORM_DEFAULTS)
    setOpen(null)
  }

  const handleSubmit = async (values: RejectInvoiceFormValues) => {
    setIsSubmitting(true)
    try {
      const result = await rejectInvoiceRequest(
        currentRow.id,
        toRejectInvoicePayload(values)
      )
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.REJECT_FAILED))
        return
      }
      toast.success(t(SUCCESS_MESSAGES.INVOICE_REJECTED))
      triggerRefresh()
      closeDialog()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => !isOpen && closeDialog()}
      title={t('Reject Invoice Request')}
      contentClassName='sm:max-w-lg'
      footer={
        <>
          <Button
            variant='outline'
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            {t('Cancel')}
          </Button>
          <Button
            form={REJECT_FORM_ID}
            type='submit'
            variant='destructive'
            disabled={isSubmitting}
          >
            {isSubmitting ? t('Processing...') : t('Reject')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={REJECT_FORM_ID}
          onSubmit={form.handleSubmit(handleSubmit)}
          className='space-y-3'
        >
          <FormField
            control={form.control}
            name='reason'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Reject Reason')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={4}
                    disabled={isSubmitting}
                    placeholder={t('Explain what the customer needs to fix')}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'The reason is emailed to the customer and shown in their invoice list.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='border-warning/40 bg-warning/10 text-warning flex items-start gap-2 rounded-lg border px-3 py-2 text-sm'>
            <TriangleAlert className='mt-0.5 size-4 shrink-0' />
            <p>
              {t('{{count}} related order(s) will return to pending invoice', {
                count: orderCount,
              })}
            </p>
          </div>
        </form>
      </Form>
    </Dialog>
  )
}
