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
import { Contact, Landmark, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useForm, type Control, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
// Named for the drawers that first used them, but the styling is drawer-neutral:
// these are the shared "titled group of fields" section primitives.
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'
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

import { saveAgentProfile } from '../../api'
import {
  AGENT_TYPE_LABEL_KEYS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../../constants'
import {
  getAgentProfileFormSchema,
  toAgentProfileFormValues,
  toAgentProfilePayload,
  type AgentProfileFormValues,
} from '../../lib/agent-forms'
import type { AgentType } from '../../types'
import { useAgent } from '../agent-provider'

const PROFILE_FORM_ID = 'agent-profile-form'

const AGENT_TYPE_HINT_KEYS: Record<AgentType, string> = {
  personal: 'Settled against your legal name and ID number.',
  company: 'Settled against a registered company and its taxpayer ID.',
}

/** Every field on this form but the subject type is a single-line text input. */
type ProfileTextFieldName = Exclude<keyof AgentProfileFormValues, 'agent_type'>

function ProfileTextField(props: {
  control: Control<AgentProfileFormValues>
  name: ProfileTextFieldName
  label: string
  placeholder?: string
  description?: string
  autoComplete?: string
  inputMode?: 'text' | 'numeric' | 'tel' | 'email'
  type?: 'text' | 'email'
  className?: string
}) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem className={props.className}>
          <FormLabel>{props.label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              type={props.type ?? 'text'}
              autoComplete={props.autoComplete}
              inputMode={props.inputMode}
              placeholder={props.placeholder}
            />
          </FormControl>
          {props.description ? (
            <FormDescription className='text-xs'>
              {props.description}
            </FormDescription>
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/** Two columns from `sm` up, so the form reads as rows instead of one long tube. */
const SECTION_GRID_CLASS_NAME = 'grid gap-x-4 gap-y-5 sm:grid-cols-2'

export function ProfileFormDialog() {
  const { t } = useTranslation()
  const { open, setOpen, overview, refreshOverview, triggerRefresh } =
    useAgent()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isOpen = open === 'profile'
  const schema = getAgentProfileFormSchema(t)
  const form = useForm<AgentProfileFormValues>({
    resolver: zodResolver(
      schema
    ) as unknown as Resolver<AgentProfileFormValues>,
    defaultValues: toAgentProfileFormValues(overview?.profile),
  })

  const agentType = form.watch('agent_type')
  const isCompany = agentType === 'company'
  // The saved account arrives masked, so the form starts blank and only warns
  // about the re-entry when there is actually something to overwrite.
  const hasSavedBankAccount = Boolean(overview?.profile.bank_account)

  if (!isOpen) return null

  const handleSubmit = async (values: AgentProfileFormValues) => {
    setIsSubmitting(true)
    try {
      const result = await saveAgentProfile(toAgentProfilePayload(values))
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.PROFILE_SAVE_FAILED))
        return
      }
      toast.success(t(SUCCESS_MESSAGES.PROFILE_SAVED))
      refreshOverview()
      triggerRefresh()
      setOpen(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && setOpen(null)}
      title={t('Agent Details')}
      description={t(
        'Submitting these details starts the review. You can keep promoting while it is in progress.'
      )}
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-2xl'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => setOpen(null)}
            disabled={isSubmitting}
          >
            {t('Cancel')}
          </Button>
          <Button form={PROFILE_FORM_ID} type='submit' disabled={isSubmitting}>
            {isSubmitting ? t('Processing...') : t('Submit for Review')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={PROFILE_FORM_ID}
          onSubmit={form.handleSubmit(handleSubmit)}
          className='flex flex-col gap-7'
        >
          <fieldset disabled={isSubmitting} className='contents'>
            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Subject Information')}
                description={t('Who the commission is settled against.')}
                icon={<UserRound className='h-4 w-4' aria-hidden='true' />}
                iconTone='primary'
              />
              <div className={SECTION_GRID_CLASS_NAME}>
                <FormField
                  control={form.control}
                  name='agent_type'
                  render={({ field }) => (
                    <FormItem className='sm:col-span-2'>
                      <FormLabel>{t('Subject Type')}</FormLabel>
                      <FormControl>
                        <RadioGroup
                          value={field.value}
                          onValueChange={(value) =>
                            field.onChange(value as AgentType)
                          }
                          className='grid gap-3 sm:grid-cols-2'
                        >
                          {(['personal', 'company'] as const).map((option) => (
                            <Label
                              key={option}
                              htmlFor={`agent-type-${option}`}
                              className='hover:bg-accent/40 has-data-checked:border-primary has-data-checked:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors'
                            >
                              <RadioGroupItem
                                value={option}
                                id={`agent-type-${option}`}
                                className='mt-0.5'
                              />
                              <span className='grid gap-1'>
                                <span className='text-sm font-medium'>
                                  {t(AGENT_TYPE_LABEL_KEYS[option])}
                                </span>
                                <span className='text-muted-foreground text-xs leading-5'>
                                  {t(AGENT_TYPE_HINT_KEYS[option])}
                                </span>
                              </span>
                            </Label>
                          ))}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isCompany ? (
                  <>
                    <ProfileTextField
                      control={form.control}
                      name='company_name'
                      label={t('Company Name')}
                      autoComplete='organization'
                      placeholder={t('Enter the registered company name')}
                    />
                    <ProfileTextField
                      control={form.control}
                      name='tax_no'
                      label={t('Taxpayer ID')}
                      autoComplete='off'
                      placeholder={t(
                        'Enter the taxpayer identification number'
                      )}
                    />
                  </>
                ) : (
                  <>
                    <ProfileTextField
                      control={form.control}
                      name='subject_name'
                      label={t('Full Name')}
                      autoComplete='name'
                      placeholder={t('Enter your legal name')}
                    />
                    <ProfileTextField
                      control={form.control}
                      name='id_no'
                      label={t('ID Number')}
                      autoComplete='off'
                      placeholder={t('Enter your government ID number')}
                    />
                  </>
                )}
              </div>
            </SideDrawerSection>

            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Payout Information')}
                description={t(
                  'Bank details are only needed for a bank transfer withdrawal. Leave them blank if you transfer to your platform balance.'
                )}
                icon={<Landmark className='h-4 w-4' aria-hidden='true' />}
                iconTone='success'
              />
              <div className={SECTION_GRID_CLASS_NAME}>
                <ProfileTextField
                  control={form.control}
                  name='bank_name'
                  label={t('Bank Name')}
                  autoComplete='off'
                  placeholder={t('Enter the bank name')}
                />
                <ProfileTextField
                  control={form.control}
                  name='bank_account'
                  label={t('Bank Account')}
                  autoComplete='off'
                  inputMode='numeric'
                  placeholder={t('Enter the bank account number')}
                  description={
                    hasSavedBankAccount
                      ? t(
                          'Saved accounts are shown with the last four digits only, so re-enter the full number to change it.'
                        )
                      : undefined
                  }
                />
                <ProfileTextField
                  control={form.control}
                  name='bank_branch'
                  label={t('Bank Branch')}
                  autoComplete='off'
                  placeholder={t('Enter the branch name')}
                />
              </div>
            </SideDrawerSection>

            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Contact Information')}
                description={t('How the reviewer reaches you about a payout.')}
                icon={<Contact className='h-4 w-4' aria-hidden='true' />}
                iconTone='info'
              />
              <div className={SECTION_GRID_CLASS_NAME}>
                <ProfileTextField
                  control={form.control}
                  name='contact_name'
                  label={t('Contact Name')}
                  autoComplete='name'
                />
                <ProfileTextField
                  control={form.control}
                  name='contact_phone'
                  label={t('Contact Phone')}
                  autoComplete='tel'
                  inputMode='tel'
                />
                <ProfileTextField
                  control={form.control}
                  name='contact_email'
                  label={t('Contact Email')}
                  autoComplete='email'
                  inputMode='email'
                  type='email'
                  className='sm:col-span-2'
                />
              </div>
            </SideDrawerSection>
          </fieldset>
        </form>
      </Form>
    </Dialog>
  )
}
