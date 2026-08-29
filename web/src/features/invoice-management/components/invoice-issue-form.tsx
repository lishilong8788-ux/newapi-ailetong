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
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { DatePicker } from '@/components/date-picker'
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

import {
  getIssueInvoiceFormDefaults,
  getIssueInvoiceFormSchema,
  type IssueInvoiceFormValues,
} from '../lib'

const NOTIFY_EMAIL_CHECKBOX_ID = 'invoice-issue-notify-email'

type InvoiceIssueFormProps = {
  formId: string
  recipientEmail: string
  isSubmitting: boolean
  onSubmit: (values: IssueInvoiceFormValues) => void
}

/**
 * Lower half of the issue dialog: the operator records what the invoicing
 * platform produced. Mounted per request so the form starts clean.
 */
export function InvoiceIssueForm(props: InvoiceIssueFormProps) {
  const { t } = useTranslation()
  const schema = getIssueInvoiceFormSchema(t)
  const form = useForm<IssueInvoiceFormValues>({
    resolver: zodResolver(
      schema
    ) as unknown as Resolver<IssueInvoiceFormValues>,
    defaultValues: getIssueInvoiceFormDefaults(),
  })

  return (
    <Form {...form}>
      <form
        id={props.formId}
        onSubmit={form.handleSubmit(props.onSubmit)}
        className='space-y-3'
      >
        <h3 className='text-sm font-semibold'>
          {t('Step 2 · Record what your invoicing software produced')}
        </h3>

        <FormField
          control={form.control}
          name='invoice_no'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Invoice Number')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete='off'
                  disabled={props.isSubmitting}
                  placeholder={t('Invoice number from your invoicing software')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='pdf_url'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('PDF Link')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='url'
                  inputMode='url'
                  autoComplete='off'
                  disabled={props.isSubmitting}
                  placeholder='https://'
                />
              </FormControl>
              <FormDescription>
                {t('The customer receives this link by email.')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='issue_date'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Issue Date')}</FormLabel>
              <FormControl>
                <DatePicker selected={field.value} onSelect={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='notify_email'
          render={({ field }) => (
            <FormItem>
              <div className='flex items-start gap-2'>
                <FormControl>
                  <Checkbox
                    id={NOTIFY_EMAIL_CHECKBOX_ID}
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked)}
                    disabled={props.isSubmitting}
                    className='mt-0.5'
                  />
                </FormControl>
                <Label
                  htmlFor={NOTIFY_EMAIL_CHECKBOX_ID}
                  className='cursor-pointer text-sm leading-snug font-normal'
                >
                  {t('Notify the customer by email after issuing')}
                  <span className='text-muted-foreground ms-1 font-mono text-xs break-all'>
                    {props.recipientEmail}
                  </span>
                </Label>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}
