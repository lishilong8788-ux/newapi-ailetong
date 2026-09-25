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
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ComboboxInput } from '@/components/ui/combobox-input'
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
import { getUserModels } from '@/lib/api'

import { getUpstreamChannels } from '../api'
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
import { CHANNEL_STATUS_CONFIG } from './constants'
import {
  COPILOT_MAX_MAX_ROUNDS,
  COPILOT_MIN_MAX_ROUNDS,
  buildCopilotFormDefaults,
  copilotChannelIdValue,
  copilotSettingsSchema,
  type CopilotSettingsFormValues,
  type CopilotSettingsOptions,
} from './copilot-settings-form'

const CHANNEL_ID_FIELD = 'copilot_setting.channel_id'

type CopilotSettingsSectionProps = {
  defaultValues: CopilotSettingsOptions
}

/**
 * Model and channel for the ops copilot.
 *
 * Neither is hardcoded. The model list is whatever this deployment can actually
 * serve (`/api/user/models`, the same source the playground picks from) and the
 * channel list is the real channels behind the ratio-sync selector in this same
 * settings area, minus its two synthesized presets, which are price feeds and
 * not routable channels.
 */
export function CopilotSettingsSection(props: CopilotSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const { data: modelsData } = useQuery({
    queryKey: ['user-models-copilot'],
    queryFn: getUserModels,
    staleTime: 5 * 60 * 1000,
  })

  const { data: channelsData } = useQuery({
    queryKey: ['upstream-channels'],
    queryFn: getUpstreamChannels,
    staleTime: 5 * 60 * 1000,
  })

  const modelOptions = useMemo(
    () => (modelsData?.data ?? []).map((name) => ({ value: name, label: name })),
    [modelsData?.data]
  )

  const channelOptions = useMemo(() => {
    const channels = channelsData?.data ?? []
    return channels
      .filter((channel) => channel.id > 0)
      .map((channel) => {
        const status =
          CHANNEL_STATUS_CONFIG[
            channel.status as keyof typeof CHANNEL_STATUS_CONFIG
          ]
        const suffix =
          channel.status === 1 || !status ? '' : ` (${t(status.label)})`
        return {
          value: String(channel.id),
          label: `#${channel.id} ${channel.name}${suffix}`,
        }
      })
  }, [channelsData?.data, t])

  const formDefaults = useMemo(
    () => buildCopilotFormDefaults(props.defaultValues),
    [props.defaultValues]
  )

  const { form, handleSubmit, isDirty, isSubmitting } =
    useSettingsForm<CopilotSettingsFormValues>({
      resolver: zodResolver(copilotSettingsSchema) as Resolver<
        CopilotSettingsFormValues,
        unknown,
        CopilotSettingsFormValues
      >,
      defaultValues: formDefaults,
      onSubmit: async (_data, changedFields) => {
        for (const [key, value] of Object.entries(changedFields)) {
          await updateOption.mutateAsync({
            key,
            value:
              key === CHANNEL_ID_FIELD
                ? copilotChannelIdValue(String(value))
                : (value as string | number | boolean),
          })
        }
      },
    })

  const isBusy = updateOption.isPending || isSubmitting

  return (
    <SettingsSection title={t('Ops Copilot')}>
      <FormNavigationGuard when={isDirty} />

      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit} autoComplete='off'>
          <SettingsPageFormActions onSave={handleSubmit} isSaving={isBusy} />
          <FormDirtyIndicator isDirty={isDirty} />

          <FormField
            control={form.control}
            name='copilot_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable the ops copilot')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Off by default: an upgrade must never silently switch on an admin assistant.'
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

          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='copilot_setting.model'
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor='copilot-model'>
                    {t('Copilot model')}
                  </FormLabel>
                  <FormControl>
                    <ComboboxInput
                      id='copilot-model'
                      options={modelOptions}
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder={t('Select or enter model name')}
                      emptyText={t('No models found')}
                      allowCustomValue
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Pick from the models this deployment can serve. The model must support function calling / tool use, or the copilot cannot work.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='copilot_setting.channel_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor='copilot-channel'>
                    {t('Pinned channel')}
                  </FormLabel>
                  <FormControl>
                    <ComboboxInput
                      id='copilot-channel'
                      options={channelOptions}
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder={t('Automatic routing (no pinning)')}
                      emptyText={t('No channels found')}
                      allowCustomValue
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Optional. Pinning keeps the copilot on a channel you know is good instead of a flaky one. Empty means normal routing.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='copilot_setting.max_rounds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Tool-call rounds per question')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={COPILOT_MIN_MAX_ROUNDS}
                      max={COPILOT_MAX_MAX_ROUNDS}
                      step={1}
                      {...safeNumberFieldProps(field)}
                      disabled={isBusy}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'A guard against a looping model: after this many tool-call rounds the copilot answers with what it has instead of burning more tokens.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
