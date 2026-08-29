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
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'

import { ERROR_MESSAGES, INVOICE_TYPE_LABEL_KEYS } from '../../constants'
import {
  INVOICE_REQUEST_FORM_DEFAULT_VALUES,
  getInvoiceRequestFormSchema,
  isProfileReadyForSpecialInvoice,
  type InvoiceRequestFormValues,
} from '../../lib'
import type { InvoiceProfile, InvoiceableOrder } from '../../types'
import { InvoiceRequestOrderSummary } from './invoice-request-order-summary'
import { InvoiceRequestProfileField } from './invoice-request-profile-field'

interface InvoiceRequestDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orders: InvoiceableOrder[]
  totalMinor: number
  currency: string | null
  profiles: InvoiceProfile[]
  defaultEmail: string
  submitting: boolean
  onManageProfiles: () => void
  onSubmit: (
    values: InvoiceRequestFormValues,
    orders: InvoiceableOrder[]
  ) => Promise<boolean>
}

export function InvoiceRequestDrawer(props: InvoiceRequestDrawerProps) {
  const { t } = useTranslation()

  const form = useForm<InvoiceRequestFormValues>({
    resolver: zodResolver(getInvoiceRequestFormSchema(t)),
    defaultValues: INVOICE_REQUEST_FORM_DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!props.open) return
    const preferred =
      props.profiles.find((profile) => profile.is_default) ?? props.profiles[0]
    form.reset({
      ...INVOICE_REQUEST_FORM_DEFAULT_VALUES,
      profile_id: preferred?.id ?? 0,
      recipient_email: props.defaultEmail,
    })
  }, [form, props.defaultEmail, props.open, props.profiles])

  const selectedProfileId = form.watch('profile_id')
  const invoiceType = form.watch('invoice_type')
  const selectedProfile = props.profiles.find(
    (profile) => profile.id === selectedProfileId
  )
  const specialBlocked =
    invoiceType === 'special' &&
    !isProfileReadyForSpecialInvoice(selectedProfile)

  const onSubmit = async (values: InvoiceRequestFormValues) => {
    if (specialBlocked) return
    const succeeded = await props.onSubmit(values, props.orders)
    if (succeeded) {
      props.onOpenChange(false)
    }
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[600px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t('Apply for Invoice')}</SheetTitle>
          <SheetDescription>
            {t('Review the selected orders and confirm the invoice details.')}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='invoice-request-form'
            className={sideDrawerFormClassName()}
            onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          >
            <InvoiceRequestOrderSummary
              orders={props.orders}
              totalMinor={props.totalMinor}
              currency={props.currency}
            />
            <fieldset disabled={props.submitting} className='contents'>
              <SideDrawerSection>
                <InvoiceRequestProfileField
                  control={form.control}
                  profiles={props.profiles}
                  selectedProfile={selectedProfile}
                  onManageProfiles={props.onManageProfiles}
                />

                <FormField
                  control={form.control}
                  name='invoice_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Invoice Type')}</FormLabel>
                      <FormControl>
                        <RadioGroup
                          value={field.value}
                          onValueChange={(value) =>
                            field.onChange(value as 'normal' | 'special')
                          }
                          className='flex gap-6'
                        >
                          {(['normal', 'special'] as const).map((option) => (
                            <div
                              key={option}
                              className='flex items-center gap-2'
                            >
                              <RadioGroupItem
                                value={option}
                                id={`invoice-type-${option}`}
                              />
                              <Label
                                htmlFor={`invoice-type-${option}`}
                                className='cursor-pointer font-normal'
                              >
                                {t(INVOICE_TYPE_LABEL_KEYS[option])}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {specialBlocked && (
                  <Alert variant='destructive'>
                    <AlertDescription>
                      {t(ERROR_MESSAGES.SPECIAL_INVOICE_BANK_REQUIRED)}
                    </AlertDescription>
                  </Alert>
                )}

                <FormField
                  control={form.control}
                  name='recipient_email'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Recipient Email')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='email'
                          autoComplete='email'
                          placeholder={t('Enter the recipient email')}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'The invoice will be sent to this email once issued.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='remark'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Remark')}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          placeholder={t('Optional note for the finance team')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SideDrawerSection>
            </fieldset>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button type='button' variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button
            form='invoice-request-form'
            type='submit'
            disabled={
              props.submitting ||
              props.orders.length === 0 ||
              props.profiles.length === 0 ||
              specialBlocked
            }
          >
            {props.submitting ? t('Submitting...') : t('Submit')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
