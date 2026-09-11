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

import { approveWithdrawal, failWithdrawal, rejectWithdrawal } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  REASON_FORM_DEFAULTS,
  getReasonFormSchema,
  isReasonComplete,
  toReasonPayload,
  type ReasonFormValues,
} from '../lib/admin-forms'
import { formatCommissionAmount, formatWithdrawalNo } from '../lib/format'
import { useAgents } from './agents-provider'

const WITHDRAWAL_AUDIT_FORM_ID = 'withdrawal-audit-form'

/**
 * Approve, reject, or mark-failed for one withdrawal.
 *
 * Reject and mark-failed both release the claimed commission back to the agent's
 * withdrawable balance, and both are visible to the agent, so both require a
 * written reason before the button will submit. Approve only moves the request
 * into the payment queue, so it needs a confirmation and nothing more.
 */
export function WithdrawalAuditDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentWithdrawal, triggerRefresh } = useAgents()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const schema = getReasonFormSchema(t)
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<ReasonFormValues>,
    defaultValues: REASON_FORM_DEFAULTS,
  })
  const reasonDraft = form.watch('reason')

  const isApprove = open === 'withdrawal-approve' && currentWithdrawal !== null
  const isReject = open === 'withdrawal-reject' && currentWithdrawal !== null
  const isFail = open === 'withdrawal-fail' && currentWithdrawal !== null

  if (!isApprove && !isReject && !isFail) return null
  if (!currentWithdrawal) return null

  const needsReason = isReject || isFail

  const closeDialog = () => {
    form.reset(REASON_FORM_DEFAULTS)
    setOpen(null)
  }

  const runApprove = async () => {
    setIsSubmitting(true)
    try {
      const result = await approveWithdrawal(currentWithdrawal.id)
      if (!result.success) {
        toast.error(
          result.message || t(ERROR_MESSAGES.APPROVE_WITHDRAWAL_FAILED)
        )
        return
      }
      toast.success(t(SUCCESS_MESSAGES.WITHDRAWAL_APPROVED))
      triggerRefresh()
      closeDialog()
    } finally {
      setIsSubmitting(false)
    }
  }

  const runReasoned = async (values: ReasonFormValues) => {
    setIsSubmitting(true)
    try {
      const payload = toReasonPayload(values)
      const result = isFail
        ? await failWithdrawal(currentWithdrawal.id, payload)
        : await rejectWithdrawal(currentWithdrawal.id, payload)
      if (!result.success) {
        const fallback = isFail
          ? ERROR_MESSAGES.FAIL_WITHDRAWAL_FAILED
          : ERROR_MESSAGES.REJECT_WITHDRAWAL_FAILED
        toast.error(result.message || t(fallback))
        return
      }
      toast.success(
        t(
          isFail
            ? SUCCESS_MESSAGES.WITHDRAWAL_FAILED
            : SUCCESS_MESSAGES.WITHDRAWAL_REJECTED
        )
      )
      triggerRefresh()
      closeDialog()
    } finally {
      setIsSubmitting(false)
    }
  }

  let title = t('Approve Withdrawal')
  if (isReject) title = t('Reject Withdrawal')
  else if (isFail) title = t('Mark Payout Failed')

  let submitLabel = t('Approve')
  if (isReject) submitLabel = t('Reject')
  else if (isFail) submitLabel = t('Mark Payout Failed')

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => !nextOpen && closeDialog()}
      title={title}
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
            form={needsReason ? WITHDRAWAL_AUDIT_FORM_ID : undefined}
            type={needsReason ? 'submit' : 'button'}
            variant={needsReason ? 'destructive' : 'default'}
            disabled={
              isSubmitting || (needsReason && !isReasonComplete(reasonDraft))
            }
            onClick={() => {
              if (isApprove) void runApprove()
            }}
          >
            {isSubmitting ? t('Processing...') : submitLabel}
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

        {isApprove && (
          <p className='text-muted-foreground text-sm'>
            {t(
              'The request moves to the payment queue. The claimed commission stays held until it is paid.'
            )}
          </p>
        )}

        {needsReason && (
          <>
            <div className='border-warning/40 bg-warning/10 text-warning flex items-start gap-2 rounded-lg border px-3 py-2 text-sm'>
              <TriangleAlert
                className='mt-0.5 size-4 shrink-0'
                aria-hidden='true'
              />
              <p>
                {t(
                  'The claimed commission returns to the withdrawable balance and the agent can request it again.'
                )}
              </p>
            </div>

            <Form {...form}>
              <form
                id={WITHDRAWAL_AUDIT_FORM_ID}
                onSubmit={form.handleSubmit(runReasoned)}
                className='space-y-3'
              >
                <FormField
                  control={form.control}
                  name='reason'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {isFail ? t('Failure Reason') : t('Reject Reason')}
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={4}
                          disabled={isSubmitting}
                          placeholder={
                            isFail
                              ? t('What went wrong with the transfer?')
                              : t('Explain what the agent needs to fix')
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Shown to the agent and recorded in the audit log.')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </>
        )}
      </div>
    </Dialog>
  )
}
