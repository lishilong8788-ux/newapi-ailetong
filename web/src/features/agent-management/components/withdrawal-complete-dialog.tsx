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
import { Input } from '@/components/ui/input'

import { completeWithdrawal } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  VOUCHER_FORM_DEFAULTS,
  getVoucherFormSchema,
  isVoucherComplete,
  type VoucherFormValues,
} from '../lib/admin-forms'
import { formatCommissionAmount, formatWithdrawalNo } from '../lib/format'
import { useAgents } from './agents-provider'

const COMPLETE_FORM_ID = 'withdrawal-complete-form'

/**
 * Records a completed bank transfer.
 *
 * The voucher number is mandatory and the submit button stays disabled without
 * one: marking a payout paid is terminal — the commission moves to `paid` and the
 * request leaves every queue — so the bank reference is the only thing that makes
 * it auditable afterwards. Payment itself is an offline action; this dialog only
 * records that it happened.
 */
export function WithdrawalCompleteDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentWithdrawal, triggerRefresh } = useAgents()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const schema = getVoucherFormSchema(t)
  const form = useForm<VoucherFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<VoucherFormValues>,
    defaultValues: VOUCHER_FORM_DEFAULTS,
  })
  const voucherDraft = form.watch('voucher')

  const isOpen = open === 'withdrawal-complete' && currentWithdrawal !== null

  if (!isOpen || !currentWithdrawal) return null

  const closeDialog = () => {
    form.reset(VOUCHER_FORM_DEFAULTS)
    setOpen(null)
  }

  const handleSubmit = async (values: VoucherFormValues) => {
    setIsSubmitting(true)
    try {
      const result = await completeWithdrawal(currentWithdrawal.id, {
        voucher: values.voucher.trim(),
      })
      if (!result.success) {
        toast.error(
          result.message || t(ERROR_MESSAGES.COMPLETE_WITHDRAWAL_FAILED)
        )
        return
      }
      toast.success(t(SUCCESS_MESSAGES.WITHDRAWAL_COMPLETED))
      triggerRefresh()
      closeDialog()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => !nextOpen && closeDialog()}
      title={t('Mark Withdrawal Paid')}
      description={t(
        'Record the bank reference for the transfer you just made.'
      )}
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
            form={COMPLETE_FORM_ID}
            type='submit'
            disabled={isSubmitting || !isVoucherComplete(voucherDraft)}
          >
            {isSubmitting ? t('Processing...') : t('Mark Paid')}
          </Button>
        </>
      }
    >
      <div className='space-y-3'>
        <p className='text-sm'>
          {t('{{no}} · net payout {{amount}}', {
            no: formatWithdrawalNo(currentWithdrawal.id),
            amount: formatCommissionAmount(currentWithdrawal.actual_amount),
          })}
        </p>

        <div className='border-warning/40 bg-warning/10 text-warning flex items-start gap-2 rounded-lg border px-3 py-2 text-sm'>
          <TriangleAlert
            className='mt-0.5 size-4 shrink-0'
            aria-hidden='true'
          />
          <p>
            {t(
              'This settles the claimed commission and cannot be undone. Only confirm once the transfer has actually left the bank.'
            )}
          </p>
        </div>

        <Form {...form}>
          <form
            id={COMPLETE_FORM_ID}
            onSubmit={form.handleSubmit(handleSubmit)}
            className='space-y-3'
          >
            <FormField
              control={form.control}
              name='voucher'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Payment Voucher')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={isSubmitting}
                      placeholder={t('Bank reference or transaction number')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Stored with the request so the transfer can be traced later.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </div>
    </Dialog>
  )
}
