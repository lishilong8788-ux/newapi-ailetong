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

import { INVOICE_TITLE_TYPE_LABEL_KEYS } from '../../constants'
import {
  INVOICE_PROFILE_FORM_DEFAULT_VALUES,
  getInvoiceProfileFormSchema,
  transformProfileToFormValues,
  type InvoiceProfileFormValues,
} from '../../lib'
import type { InvoiceProfile } from '../../types'

interface InvoiceProfileDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentProfile?: InvoiceProfile
  saving: boolean
  onSubmit: (values: InvoiceProfileFormValues, id?: number) => Promise<boolean>
}

export function InvoiceProfileDrawer(props: InvoiceProfileDrawerProps) {
  const { t } = useTranslation()
  const isUpdate = props.currentProfile !== undefined

  const form = useForm<InvoiceProfileFormValues>({
    resolver: zodResolver(getInvoiceProfileFormSchema(t)),
    defaultValues: INVOICE_PROFILE_FORM_DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!props.open) return
    form.reset(
      props.currentProfile
        ? transformProfileToFormValues(props.currentProfile)
        : INVOICE_PROFILE_FORM_DEFAULT_VALUES
    )
  }, [form, props.currentProfile, props.open])

  const titleType = form.watch('title_type')
  const isCompany = titleType === 'company'

  const onSubmit = async (values: InvoiceProfileFormValues) => {
    const succeeded = await props.onSubmit(values, props.currentProfile?.id)
    if (succeeded) {
      props.onOpenChange(false)
    }
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={(next) => {
        props.onOpenChange(next)
        if (!next) form.reset(INVOICE_PROFILE_FORM_DEFAULT_VALUES)
      }}
    >
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[560px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate ? t('Edit Invoice Title') : t('Add Invoice Title')}
          </SheetTitle>
          <SheetDescription>
            {t('These details are printed on the invoice you receive.')}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='invoice-profile-form'
            className={sideDrawerFormClassName()}
            onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          >
            <fieldset disabled={props.saving} className='contents'>
              <SideDrawerSection>
                <FormField
                  control={form.control}
                  name='title_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Title Type')}</FormLabel>
                      <FormControl>
                        <RadioGroup
                          value={field.value}
                          onValueChange={(value) =>
                            field.onChange(value as 'personal' | 'company')
                          }
                          className='flex gap-6'
                        >
                          {(['company', 'personal'] as const).map((option) => (
                            <div
                              key={option}
                              className='flex items-center gap-2'
                            >
                              <RadioGroupItem
                                value={option}
                                id={`invoice-title-type-${option}`}
                              />
                              <Label
                                htmlFor={`invoice-title-type-${option}`}
                                className='cursor-pointer font-normal'
                              >
                                {t(INVOICE_TITLE_TYPE_LABEL_KEYS[option])}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='title'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Invoice Title')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={
                            isCompany
                              ? t('Enter the registered company name')
                              : t('Enter your name')
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isCompany && (
                  <FormField
                    control={form.control}
                    name='tax_no'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Tax ID')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t(
                              'Enter the taxpayer identification number'
                            )}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name='address'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Address')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t('Enter the address')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='phone'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Phone')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t('Enter the phone number')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isCompany && (
                  <FormField
                    control={form.control}
                    name='bank_name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Bank Name')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t('Enter the bank name')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('Required for a special VAT invoice.')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {isCompany && (
                  <FormField
                    control={form.control}
                    name='bank_account'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Bank Account')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t('Enter the bank account number')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('Required for a special VAT invoice.')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name='is_default'
                  render={({ field }) => (
                    <FormItem>
                      <div className='flex items-center gap-2'>
                        <FormControl>
                          <Checkbox
                            id='invoice-profile-default'
                            checked={field.value}
                            onCheckedChange={(checked) =>
                              field.onChange(checked)
                            }
                          />
                        </FormControl>
                        <Label
                          htmlFor='invoice-profile-default'
                          className='cursor-pointer font-normal'
                        >
                          {t('Set as Default')}
                        </Label>
                      </div>
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
            form='invoice-profile-form'
            type='submit'
            disabled={props.saving}
          >
            {props.saving ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
