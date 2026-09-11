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
import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import {
  COST_RATE_KEYS,
  costOptionSaveOrder,
  costSettingsSchema,
  percentToRate,
  rateToPercent,
  type CostSettingsFormValues,
} from './cost-settings-form'

type CostSettingsDefaults = Pick<
  CostSettingsFormValues,
  | 'cost_setting.enabled'
  | 'cost_setting.guard_enabled'
  | 'cost_setting.warn_rate'
  | 'cost_setting.alert_rate'
  | 'cost_setting.demote_rate'
  | 'cost_setting.disable_rate'
  | 'cost_setting.window_minutes'
  | 'cost_setting.min_requests'
  | 'cost_setting.max_unknown_rate'
  | 'cost_setting.cooldown_minutes'
  | 'cost_setting.flush_interval_seconds'
>

type CostSettingsSectionProps = {
  defaultValues: CostSettingsDefaults
}

export function CostSettingsSection(props: CostSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const formDefaults = useMemo<CostSettingsFormValues>(() => {
    const d = props.defaultValues
    return {
      ...d,
      'cost_setting.warn_rate': rateToPercent(d['cost_setting.warn_rate']),
      'cost_setting.alert_rate': rateToPercent(d['cost_setting.alert_rate']),
      'cost_setting.demote_rate': rateToPercent(d['cost_setting.demote_rate']),
      'cost_setting.disable_rate': rateToPercent(
        d['cost_setting.disable_rate']
      ),
      'cost_setting.max_unknown_rate': rateToPercent(
        d['cost_setting.max_unknown_rate']
      ),
    }
  }, [props.defaultValues])

  const { form, handleSubmit, isDirty, isSubmitting } =
    useSettingsForm<CostSettingsFormValues>({
      resolver: zodResolver(costSettingsSchema) as Resolver<
        CostSettingsFormValues,
        unknown,
        CostSettingsFormValues
      >,
      defaultValues: formDefaults,
      onSubmit: async (_data, changedFields) => {
        // Lowest threshold first: the server validates each key against the
        // stored values of the others, so the chain has to shift bottom-up.
        const updates = Object.entries(changedFields).sort(
          ([a], [b]) => costOptionSaveOrder(a) - costOptionSaveOrder(b)
        )

        for (const [key, value] of updates) {
          await updateOption.mutateAsync({
            key,
            value: COST_RATE_KEYS.has(key)
              ? percentToRate(Number(value))
              : (value as string | number | boolean),
          })
        }
      },
    })

  const isBusy = updateOption.isPending || isSubmitting

  return (
    <SettingsSection title={t('Cost & Margin')}>
      <FormNavigationGuard when={isDirty} />

      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit} autoComplete='off'>
          <SettingsPageFormActions onSave={handleSubmit} isSaving={isBusy} />
          <FormDirtyIndicator isDirty={isDirty} />

          {/* The everyday surface is exactly one switch. Everything else
            (guard thresholds, windows, cooldowns) belongs to the L3/L4
            automation phase and lives behind the advanced fold until then. */}
          <FormField
            control={form.control}
            name='cost_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable cost accounting')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Records the upstream cost of every request and feeds the cost analytics page. Does not change any pricing or routing on its own.'
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
            name='cost_setting.guard_enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>
                    {t('Enable margin guarding (L3/L4 actions)')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'Reserved for a later phase. Enabling accounting alone is enough for reporting and alerts.'
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

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger
              render={
                <button
                  type='button'
                  className='text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 py-1 text-left text-xs font-medium transition-colors'
                  aria-expanded={advancedOpen}
                />
              }
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                aria-hidden='true'
              />
              {t('Advanced thresholds & gates')}
            </CollapsibleTrigger>
            <CollapsibleContent className='mt-2 space-y-5'>
              <div>
                <h4 className='font-medium'>{t('Alert thresholds')}</h4>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t(
                    'Margin rate thresholds, chained: disable ≤ demote ≤ alert ≤ watch. Enter 20 for 20%.'
                  )}
                </p>
              </div>

              <SettingsFormGrid>
                <FormField
                  control={form.control}
                  name='cost_setting.warn_rate'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Watch line (%)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          max={100}
                          step={0.5}
                          {...safeNumberFieldProps(field)}
                          disabled={isBusy}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Below this the channel is flagged in reports.')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='cost_setting.alert_rate'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Alert line (%)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          max={100}
                          step={0.5}
                          {...safeNumberFieldProps(field)}
                          disabled={isBusy}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Below this a notification is sent to root.')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='cost_setting.demote_rate'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Demote line (%)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          max={100}
                          step={0.5}
                          {...safeNumberFieldProps(field)}
                          disabled={isBusy}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Reserved for the guarding phase (priority demotion).')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='cost_setting.disable_rate'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Disable line (%)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          max={100}
                          step={0.5}
                          {...safeNumberFieldProps(field)}
                          disabled={isBusy}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Reserved for the guarding phase (loss floor).')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsFormGrid>

              <div>
                <h4 className='font-medium'>{t('Guard gates')}</h4>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t(
                    'Gates that must all hold before any automatic action is even considered.'
                  )}
                </p>
              </div>

              <SettingsFormGrid>
                <FormField
                  control={form.control}
                  name='cost_setting.window_minutes'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Evaluation window (minutes)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={1}
                          step={1}
                          {...safeNumberFieldProps(field)}
                          disabled={isBusy}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Short windows react fast but are noisy.')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='cost_setting.min_requests'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Minimum requests in window')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={1}
                          step={1}
                          {...safeNumberFieldProps(field)}
                          disabled={isBusy}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Small-sample channels never trigger; their margin swings are noise.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='cost_setting.max_unknown_rate'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Max unpriced share (%)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          max={100}
                          step={0.5}
                          {...safeNumberFieldProps(field)}
                          disabled={isBusy}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Above this share the ledger is untrustworthy and automation is suppressed.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='cost_setting.cooldown_minutes'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Cooldown (minutes)')}</FormLabel>
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
                        {t('Minimum spacing between automatic actions.')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='cost_setting.flush_interval_seconds'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Aggregation flush (seconds)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={5}
                          step={1}
                          {...safeNumberFieldProps(field)}
                          disabled={isBusy}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'How often in-memory cost buckets are written to disk.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsFormGrid>
            </CollapsibleContent>
          </Collapsible>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
