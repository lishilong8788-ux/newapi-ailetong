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
import { useMemo } from 'react'
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

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
import { Switch } from '@/components/ui/switch'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsFormGridItem,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import {
  AGENT_RATE_KEYS,
  agentOptionSaveOrder,
  agentSettingsSchema,
  commissionRateToPercent,
  percentToCommissionRate,
  type AgentSettingsFormValues,
} from './agent-settings-form'

type AgentSettingsDefaults = {
  AgentEnabled: boolean
  AgentDefaultRate: number
  AgentMaxRate: number
  AgentFreezeDays: number
  AgentMinWithdrawal: number
  AgentWithdrawalFeeRate: number
  AgentAutoApprove: boolean
  AgentBalanceNeedAudit: boolean
  AgentSubscriptionCommission: boolean
}

type AgentSettingsSectionProps = {
  defaultValues: AgentSettingsDefaults
}

export function AgentSettingsSection(props: AgentSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const formDefaults = useMemo<AgentSettingsFormValues>(
    () => ({
      ...props.defaultValues,
      AgentDefaultRate: commissionRateToPercent(
        props.defaultValues.AgentDefaultRate
      ),
      AgentMaxRate: commissionRateToPercent(props.defaultValues.AgentMaxRate),
      AgentWithdrawalFeeRate: commissionRateToPercent(
        props.defaultValues.AgentWithdrawalFeeRate
      ),
    }),
    [props.defaultValues]
  )

  const { form, handleSubmit, isDirty, isSubmitting } =
    useSettingsForm<AgentSettingsFormValues>({
      resolver: zodResolver(agentSettingsSchema) as Resolver<
        AgentSettingsFormValues,
        unknown,
        AgentSettingsFormValues
      >,
      defaultValues: formDefaults,
      onSubmit: async (_data, changedFields) => {
        const updates = Object.entries(changedFields).sort(
          ([a], [b]) => agentOptionSaveOrder(a) - agentOptionSaveOrder(b)
        )

        for (const [key, value] of updates) {
          await updateOption.mutateAsync({
            key,
            value: AGENT_RATE_KEYS.has(key)
              ? percentToCommissionRate(Number(value))
              : (value as string | number | boolean),
          })
        }
      },
    })

  const isBusy = updateOption.isPending || isSubmitting

  return (
    <SettingsSection title={t('Agent Distribution')}>
      <FormNavigationGuard when={isDirty} />

      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit} autoComplete='off'>
          <SettingsPageFormActions onSave={handleSubmit} isSaving={isBusy} />
          <FormDirtyIndicator isDirty={isDirty} />
          <div>
            <h4 className='font-medium'>{t('Programme')}</h4>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t(
                'While the programme is off, no commission is recorded and the agent entries stay hidden.'
              )}
            </p>
          </div>

          <FormField
            control={form.control}
            name='AgentEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable agent distribution')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Master switch for the whole programme, including commission accrual and withdrawals.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isBusy}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='AgentSubscriptionCommission'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>
                    {t('Pay commission on subscription orders')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'When off, only wallet top-ups earn commission. Subscriptions renew on their own schedule, so enabling this keeps paying out on every renewal.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isBusy}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <div>
            <h4 className='font-medium'>{t('Commission')}</h4>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t(
                'Rates are entered as percentages of the paid amount and stored as fractions.'
              )}
            </p>
          </div>

          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='AgentDefaultRate'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Default commission rate (%)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={100}
                      step={0.01}
                      {...safeNumberFieldProps(field)}
                      disabled={isBusy}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Applied to any agent without an explicit rate. Enter 5 for 5%.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='AgentMaxRate'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Maximum commission rate (%)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={100}
                      step={0.01}
                      {...safeNumberFieldProps(field)}
                      disabled={isBusy}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Ceiling for every per-agent rate. This is what stops a mistyped rate from turning top-ups into a net loss, so keep it below your margin.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='AgentFreezeDays'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Commission freeze window (days)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      step={1}
                      {...safeNumberFieldProps(field)}
                      disabled={isBusy}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'New commission stays unwithdrawable for this long. It is the only guard against the top-up, withdraw, then refund arbitrage, so it should cover your payment providers refund window.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>
          <div>
            <h4 className='font-medium'>{t('Withdrawal')}</h4>
          </div>

          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='AgentMinWithdrawal'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Minimum withdrawal (CNY)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      step={0.01}
                      {...safeNumberFieldProps(field)}
                      disabled={isBusy}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Smallest amount an agent may request in one payout.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='AgentWithdrawalFeeRate'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Withdrawal fee rate (%)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={100}
                      step={0.01}
                      {...safeNumberFieldProps(field)}
                      disabled={isBusy}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Deducted from each payout. Enter 0 to pay the full amount.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SettingsFormGridItem span='full'>
              <FormField
                control={form.control}
                name='AgentBalanceNeedAudit'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>
                        {t('Review payouts to account balance')}
                      </FormLabel>
                      <FormDescription>
                        {t(
                          'Balance payouts settle instantly when this is off. Bank transfers are always reviewed.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isBusy}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />
            </SettingsFormGridItem>
          </SettingsFormGrid>

          <div>
            <h4 className='font-medium'>{t('Review')}</h4>
          </div>

          <FormField
            control={form.control}
            name='AgentAutoApprove'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>
                    {t('Approve agent applications automatically')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'When off, an administrator reviews every agent identity before it can earn commission.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isBusy}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
