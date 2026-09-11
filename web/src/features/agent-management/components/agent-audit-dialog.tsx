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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'

import { auditAgentProfile, setAgentStatus } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  REASON_FORM_DEFAULTS,
  getReasonFormSchema,
  isReasonComplete,
  type ReasonFormValues,
} from '../lib/admin-forms'
import { useAgents } from './agents-provider'

const AUDIT_FORM_ID = 'agent-audit-form'

/**
 * The confirmation step for the three agent-state decisions: approve/reject a
 * subject, suspend/reactivate an active one, and approve a selection in bulk.
 *
 * They share one dialog because they share one shape — state a consequence, take
 * a reason where the decision is against the agent, confirm. Rejection is the
 * only branch that blocks submission until a reason is written; it is the only
 * branch the agent sees and has to act on.
 */
export function AgentAuditDialog() {
  const { t } = useTranslation()
  const {
    open,
    setOpen,
    currentAgent,
    batchAgents,
    auditApproval,
    triggerRefresh,
  } = useAgents()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const schema = getReasonFormSchema(t)
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<ReasonFormValues>,
    defaultValues: REASON_FORM_DEFAULTS,
  })
  const reasonDraft = form.watch('reason')

  const isAudit = open === 'agent-audit' && currentAgent !== null
  const isStatusChange = open === 'agent-status' && currentAgent !== null
  const isBatchApprove =
    open === 'agent-batch-approve' && batchAgents.length > 0

  if (!isAudit && !isStatusChange && !isBatchApprove) return null

  const isRejection = isAudit && !auditApproval
  const isSuspending = isStatusChange && currentAgent?.status === 'active'
  const agentLabel =
    currentAgent?.username ||
    currentAgent?.display_name ||
    `#${currentAgent?.user_id ?? 0}`

  const closeDialog = () => {
    form.reset(REASON_FORM_DEFAULTS)
    setOpen(null)
  }

  const runAudit = async (values: ReasonFormValues) => {
    if (!currentAgent) return
    setIsSubmitting(true)
    try {
      const result = await auditAgentProfile(currentAgent.id, {
        approve: auditApproval,
        reason: isRejection ? values.reason.trim() : undefined,
      })
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.AUDIT_AGENT_FAILED))
        return
      }
      toast.success(
        t(
          auditApproval
            ? SUCCESS_MESSAGES.AGENT_APPROVED
            : SUCCESS_MESSAGES.AGENT_REJECTED
        )
      )
      triggerRefresh()
      closeDialog()
    } finally {
      setIsSubmitting(false)
    }
  }

  const runStatusChange = async () => {
    if (!currentAgent) return
    setIsSubmitting(true)
    try {
      const result = await setAgentStatus(currentAgent.id, {
        status: isSuspending ? 'suspended' : 'active',
      })
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.SET_STATUS_FAILED))
        return
      }
      toast.success(t(SUCCESS_MESSAGES.STATUS_UPDATED))
      triggerRefresh()
      closeDialog()
    } finally {
      setIsSubmitting(false)
    }
  }

  const runBatchApprove = async () => {
    setIsSubmitting(true)
    try {
      let failed = 0
      // Sequential rather than parallel: each approval writes an audit record,
      // and a partial failure has to be reportable by count.
      for (const agent of batchAgents) {
        const result = await auditAgentProfile(agent.id, { approve: true })
        if (!result.success) failed += 1
      }
      if (failed > 0) {
        toast.error(
          t('{{count}} of the selected agents could not be approved', {
            count: failed,
          })
        )
      } else {
        toast.success(t(SUCCESS_MESSAGES.AGENT_APPROVED))
      }
      triggerRefresh()
      closeDialog()
    } finally {
      setIsSubmitting(false)
    }
  }

  let title = t('Approve Agent')
  if (isRejection) title = t('Reject Agent Application')
  else if (isSuspending) title = t('Suspend Agent')
  else if (isStatusChange) title = t('Reactivate Agent')
  else if (isBatchApprove) title = t('Approve Selected Agents')

  const submitLabel = isRejection ? t('Reject') : t('Confirm')
  const confirmDisabled =
    isSubmitting || (isRejection && !isReasonComplete(reasonDraft))

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
            form={isAudit ? AUDIT_FORM_ID : undefined}
            type={isAudit ? 'submit' : 'button'}
            variant={isRejection || isSuspending ? 'destructive' : 'default'}
            disabled={confirmDisabled}
            onClick={() => {
              if (isStatusChange) void runStatusChange()
              else if (isBatchApprove) void runBatchApprove()
            }}
          >
            {isSubmitting ? t('Processing...') : submitLabel}
          </Button>
        </>
      }
    >
      {isBatchApprove && (
        <p className='text-sm'>
          {t('{{count}} selected agent(s) will be approved.', {
            count: batchAgents.length,
          })}
        </p>
      )}

      {isStatusChange && (
        <div className='space-y-3 text-sm'>
          <p>
            {isSuspending
              ? t('{{agent}} will stop earning new commission immediately.', {
                  agent: agentLabel,
                })
              : t('{{agent}} will start earning commission again.', {
                  agent: agentLabel,
                })}
          </p>
          {isSuspending && (
            <div className='border-warning/40 bg-warning/10 text-warning flex items-start gap-2 rounded-lg border px-3 py-2'>
              <TriangleAlert
                className='mt-0.5 size-4 shrink-0'
                aria-hidden='true'
              />
              <p>
                {t(
                  'Commission already earned stays withdrawable. Only new commission stops.'
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {isAudit && (
        <Form {...form}>
          <form
            id={AUDIT_FORM_ID}
            onSubmit={form.handleSubmit(runAudit)}
            className='space-y-3'
          >
            <p className='text-sm'>
              {isRejection
                ? t(
                    'The reason is shown to {{agent}} so the subject details can be corrected and resubmitted.',
                    { agent: agentLabel }
                  )
                : t(
                    '{{agent}} will be able to withdraw commission once approved.',
                    { agent: agentLabel }
                  )}
            </p>

            {isRejection && (
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
                        placeholder={t('Explain what the agent needs to fix')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </form>
        </Form>
      )}
    </Dialog>
  )
}
