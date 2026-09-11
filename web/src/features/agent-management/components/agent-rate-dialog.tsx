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
import { Checkbox } from '@/components/ui/checkbox'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { setAgentCommissionRate } from '../api'
import { AGENT_VALIDATION, SUCCESS_MESSAGES } from '../constants'
import {
  RATE_FORM_DEFAULTS,
  getRateFormSchema,
  toRatePayload,
  type RateFormValues,
} from '../lib/admin-forms'
import { formatCommissionRate } from '../lib/format'
import { useAgents } from './agents-provider'

const RATE_FORM_ID = 'agent-rate-form'

/**
 * Commission rate editor for one agent or for a selection.
 *
 * The rate is the one field on this page that changes what the platform pays out
 * on every future top-up, so the batch path states its blast radius — how many
 * agents and how many customers currently sit behind that number — before the
 * confirm button will do anything. A reason is mandatory in both paths because
 * the change is written to the audit log.
 */
export function AgentRateDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentAgent, batchAgents, triggerRefresh } =
    useAgents()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const schema = getRateFormSchema(t)
  const form = useForm<RateFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<RateFormValues>,
    defaultValues: RATE_FORM_DEFAULTS,
  })
  const followDefault = form.watch('followDefault')

  const isSingle = open === 'agent-rate' && currentAgent !== null
  const isBatch = open === 'agent-batch-rate' && batchAgents.length > 0

  if (!isSingle && !isBatch) return null

  let targets = batchAgents
  if (!isBatch) {
    targets = currentAgent ? [currentAgent] : []
  }
  const affectedCustomers = targets.reduce(
    (total, agent) => total + (agent.customer_count ?? 0),
    0
  )
  const currentRateLabel = currentAgent
    ? (formatCommissionRate(currentAgent.commission_rate) ??
      t('Global default'))
    : null

  const closeDialog = () => {
    form.reset(RATE_FORM_DEFAULTS)
    setOpen(null)
  }

  const handleSubmit = async (values: RateFormValues) => {
    const payload = toRatePayload(values)
    setIsSubmitting(true)
    try {
      let failed = 0
      let firstError = ''
      for (const agent of targets) {
        const result = await setAgentCommissionRate(agent.id, payload)
        if (!result.success) {
          failed += 1
          firstError = firstError || (result.message ?? '')
        }
      }
      if (failed > 0) {
        // The server owns the rate ceiling, so its message is the one that
        // explains a rejection; the count only matters for a batch.
        toast.error(
          firstError ||
            t('{{count}} of the selected agents could not be updated', {
              count: failed,
            })
        )
      } else {
        toast.success(t(SUCCESS_MESSAGES.RATE_UPDATED))
      }
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
      title={
        isBatch
          ? t('Adjust Commission Rate in Bulk')
          : t('Adjust Commission Rate')
      }
      description={
        isBatch
          ? undefined
          : t(
              'Rate changes apply to future commission only; history keeps its own snapshot.'
            )
      }
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
            form={RATE_FORM_ID}
            type='submit'
            variant={isBatch ? 'destructive' : 'default'}
            disabled={isSubmitting}
          >
            {isSubmitting ? t('Processing...') : t('Confirm')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={RATE_FORM_ID}
          onSubmit={form.handleSubmit(handleSubmit)}
          className='space-y-4'
        >
          {isBatch && (
            <div
              className='border-warning/40 bg-warning/10 text-warning flex items-start gap-2 rounded-lg border px-3 py-2 text-sm'
              role='alert'
            >
              <TriangleAlert
                className='mt-0.5 size-4 shrink-0'
                aria-hidden='true'
              />
              <div className='space-y-1'>
                <p className='font-medium'>
                  {t('{{count}} agent(s) will be repriced', {
                    count: targets.length,
                  })}
                </p>
                <p>
                  {t(
                    'They currently hold {{customers}} customer(s). The new rate drives every future top-up commission for all of them.',
                    { customers: affectedCustomers }
                  )}
                </p>
              </div>
            </div>
          )}

          {isSingle && currentRateLabel && (
            <p className='text-sm'>
              {t('Current rate: {{rate}}', { rate: currentRateLabel })}
            </p>
          )}

          <FormField
            control={form.control}
            name='followDefault'
            render={({ field }) => (
              <FormItem>
                <div className='flex items-center gap-2'>
                  <FormControl>
                    <Checkbox
                      id='agent-rate-follow-default'
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(!!checked)}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <Label
                    htmlFor='agent-rate-follow-default'
                    className='cursor-pointer font-normal'
                  >
                    {t('Follow the global default rate')}
                  </Label>
                </div>
                <FormDescription>
                  {t(
                    'Clearing the override is different from setting 0%: 0% pays no commission at all.'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='ratePercent'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Commission Rate (%)')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    inputMode='decimal'
                    step='0.01'
                    min={AGENT_VALIDATION.RATE_MIN * 100}
                    max={AGENT_VALIDATION.RATE_MAX * 100}
                    disabled={isSubmitting || followDefault}
                    placeholder={t('For example 5 for 5%')}
                  />
                </FormControl>
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
                    placeholder={t('Why is the rate changing?')}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Recorded in the audit log with the before and after values.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
