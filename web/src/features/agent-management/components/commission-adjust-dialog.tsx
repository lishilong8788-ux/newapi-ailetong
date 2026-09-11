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
import { Lock } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'

import { adjustCommission } from '../api'
import {
  AGENT_VALIDATION,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../constants'
import {
  ADJUST_FORM_DEFAULTS,
  getAdjustFormSchema,
  isReasonComplete,
  toAdjustPayload,
  type AdjustFormValues,
} from '../lib/admin-forms'
import { formatCommissionAmount } from '../lib/format'
import { useAgents } from './agents-provider'

const ADJUST_FORM_ID = 'commission-adjust-form'

/**
 * Records a manual ledger adjustment.
 *
 * Positive adds commission the platform owes, negative claws it back. Either way
 * this writes a new row: the ledger is append-only, so an adjustment sits
 * alongside the entry it corrects instead of replacing it, and the reason is what
 * makes the pair readable a quarter later. Submission is blocked until a reason is
 * written.
 */
export function CommissionAdjustDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentAgent, triggerRefresh } = useAgents()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const schema = getAdjustFormSchema(t)
  const form = useForm<AdjustFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<AdjustFormValues>,
    defaultValues: {
      ...ADJUST_FORM_DEFAULTS,
      agentUserId: currentAgent ? String(currentAgent.user_id) : '',
    },
  })
  const reasonDraft = form.watch('reason')
  const amountDraft = form.watch('amount')

  const isOpen = open === 'commission-adjust'

  if (!isOpen) return null

  const parsedAmount = Number(amountDraft)
  const previewAmount =
    Number.isFinite(parsedAmount) && amountDraft.trim()
      ? formatCommissionAmount(parsedAmount)
      : null

  const closeDialog = () => {
    form.reset(ADJUST_FORM_DEFAULTS)
    setOpen(null)
  }

  const handleSubmit = async (values: AdjustFormValues) => {
    setIsSubmitting(true)
    try {
      const result = await adjustCommission(toAdjustPayload(values))
      if (!result.success) {
        toast.error(
          result.message || t(ERROR_MESSAGES.ADJUST_COMMISSION_FAILED)
        )
        return
      }
      toast.success(t(SUCCESS_MESSAGES.COMMISSION_ADJUSTED))
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
      title={t('Manual Commission Adjustment')}
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
            form={ADJUST_FORM_ID}
            type='submit'
            disabled={isSubmitting || !isReasonComplete(reasonDraft)}
          >
            {isSubmitting ? t('Processing...') : t('Record Adjustment')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-xs'>
          <Lock className='mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
          <p>
            {t(
              'This adds a new ledger row. Nothing already recorded is changed or removed.'
            )}
          </p>
        </div>

        <Form {...form}>
          <form
            id={ADJUST_FORM_ID}
            onSubmit={form.handleSubmit(handleSubmit)}
            className='space-y-3'
          >
            <FormField
              control={form.control}
              name='agentUserId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Agent user ID')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      min={1}
                      disabled={isSubmitting}
                      placeholder={t('The user ID of the agent')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='amount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Amount (CNY)')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      inputMode='decimal'
                      step='0.01'
                      min={-AGENT_VALIDATION.ADJUST_AMOUNT_MAX}
                      max={AGENT_VALIDATION.ADJUST_AMOUNT_MAX}
                      disabled={isSubmitting}
                      placeholder={t('Negative to claw back commission')}
                    />
                  </FormControl>
                  <FormDescription>
                    {previewAmount
                      ? t('Will be recorded as {{amount}}', {
                          amount: previewAmount,
                        })
                      : t('Positive adds commission, negative deducts it.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='reason'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Reason')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      disabled={isSubmitting}
                      placeholder={t('Why is this adjustment needed?')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Stored on the new row and in the audit log with your account.'
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
