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
import { Link } from '@tanstack/react-router'
import { ChevronsUpDown, Cpu, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ComboboxInput,
  type ComboboxInputOption,
} from '@/components/ui/combobox-input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'

import {
  COPILOT_AUTO_CHANNEL_ID,
  COPILOT_SETTINGS_SECTION,
  COPILOT_SETTINGS_URL,
} from '../constants'
import {
  findCopilotModelOption,
  formatCopilotChannel,
  resolveCopilotTarget,
  type CopilotTarget,
} from '../lib'
import type {
  CopilotConfigUpdate,
  CopilotModelOption,
  CopilotStatus,
} from '../types'

const MODEL_FIELD_ID = 'copilot-picker-model'
const CHANNEL_FIELD_ID = 'copilot-picker-channel'

export interface CopilotModelPickerProps {
  status?: CopilotStatus
  models: CopilotModelOption[]
  /** The group the offered models route in; stated so the list has a scope. */
  group?: string
  isLoading: boolean
  isSaving: boolean
  onSave: (update: CopilotConfigUpdate) => void
}

/**
 * Model and channel for the copilot, chosen from the composer.
 *
 * This exists because the settings form is three levels down (System Settings →
 * Models & Routing → Ops Copilot) and an operator who wants a different model is
 * not, at that moment, configuring a system — they are mid-conversation. The two
 * write the same options, so neither is a shadow copy.
 *
 * Every change is applied on selection rather than collected behind a save button:
 * there are two fields, both single-click, and a picker that silently held a
 * pending model would answer the next question with the old one.
 */
export function CopilotModelPicker(props: CopilotModelPickerProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const canConfigure = props.status?.can_configure ?? false
  const target = useMemo(
    () => resolveCopilotTarget(props.status, props.models),
    [props.models, props.status]
  )

  const modelOptions = useMemo(
    () =>
      props.models.map((option) => ({
        value: option.model,
        label: option.model,
      })),
    [props.models]
  )

  // Only the selected model's own channels: offering the rest would invite a pair
  // that cannot route, and the picker is the place to prevent that rather than
  // report it.
  const channelOptions = useMemo(() => {
    const selected = findCopilotModelOption(props.models, target.model)
    return (selected?.channels ?? []).map((channel) => ({
      value: String(channel.channel_id),
      label: formatCopilotChannel(channel),
    }))
  }, [props.models, target.model])

  const handleModelChange = (model: string) => {
    if (model === target.model) return
    const update: CopilotConfigUpdate = { model }
    // A pin that the new model cannot route is cleared in the same write. Leaving
    // it would send the new model to a line that does not serve it — a failure the
    // operator would read as the model being broken.
    const next = findCopilotModelOption(props.models, model)
    const keepsPin = (next?.channels ?? []).some(
      (channel) => channel.channel_id === props.status?.channel_id
    )
    if (next && !keepsPin) update.channel_id = COPILOT_AUTO_CHANNEL_ID
    props.onSave(update)
  }

  const triggerLabel = target.model || t('Pick a model')

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button
            variant='outline'
            size='sm'
            className='h-8 max-w-[min(100%,22rem)] gap-1.5 px-2 font-normal'
          >
            <Cpu
              aria-hidden='true'
              className='text-muted-foreground size-3.5'
            />
            <span className='min-w-0 truncate font-mono text-[11px]'>
              {triggerLabel}
            </span>
            {target.channel && (
              <span className='text-muted-foreground shrink-0 text-[11px]'>
                · {`#${target.channel.channel_id}`}
              </span>
            )}
            {target.isPinUnservable && (
              <TriangleAlert
                aria-hidden='true'
                className='text-destructive size-3.5 shrink-0'
              />
            )}
            <ChevronsUpDown
              aria-hidden='true'
              className='text-muted-foreground size-3 shrink-0'
            />
            <span className='sr-only'>{t('Change copilot model')}</span>
          </Button>
        }
      />

      <PopoverContent align='start' side='top' className='w-80'>
        <PickerFields
          target={target}
          canConfigure={canConfigure}
          isLoading={props.isLoading}
          isSaving={props.isSaving}
          modelOptions={modelOptions}
          channelOptions={channelOptions}
          onModelChange={handleModelChange}
          onChannelChange={(channelId) =>
            props.onSave({ channel_id: channelId })
          }
        />

        {canConfigure && (
          <>
            <Separator />
            <div className='flex items-center justify-between gap-2'>
              <Label
                htmlFor='copilot-picker-enabled'
                className='text-xs font-medium'
              >
                {t('Enable the ops copilot')}
              </Label>
              <Switch
                id='copilot-picker-enabled'
                checked={props.status?.enabled ?? false}
                onCheckedChange={(checked) =>
                  props.onSave({ enabled: checked })
                }
                disabled={props.isSaving}
              />
            </div>
          </>
        )}

        <div className='text-muted-foreground flex items-center justify-between gap-2 text-[11px]'>
          {props.group ? (
            <span className='min-w-0 truncate'>
              {t('Group: {{group}}', { group: props.group })}
            </span>
          ) : (
            <span />
          )}
          <Link
            to={COPILOT_SETTINGS_URL}
            params={{ section: COPILOT_SETTINGS_SECTION }}
            className='text-primary shrink-0 underline underline-offset-4'
          >
            {t('More settings')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type PickerFieldsProps = {
  target: CopilotTarget
  canConfigure: boolean
  isLoading: boolean
  isSaving: boolean
  modelOptions: ComboboxInputOption[]
  channelOptions: ComboboxInputOption[]
  onModelChange: (model: string) => void
  onChannelChange: (channelId: number) => void
}

/** The two fields themselves, split out because the popover also carries chrome. */
function PickerFields(inner: PickerFieldsProps) {
  const { t } = useTranslation()

  if (inner.isLoading) {
    return (
      <div className='text-muted-foreground flex items-center gap-2 py-4 text-xs'>
        <Spinner className='size-3.5' />
        {t('Loading models...')}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor={MODEL_FIELD_ID} className='text-xs font-medium'>
          {t('Copilot model')}
        </Label>
        {inner.canConfigure ? (
          <ComboboxInput
            id={MODEL_FIELD_ID}
            options={inner.modelOptions}
            value={inner.target.model}
            onValueChange={inner.onModelChange}
            placeholder={t('Select or enter model name')}
            emptyText={t('No models found')}
            allowCustomValue
          />
        ) : (
          <ReadOnlyValue value={inner.target.model || t('Not selected')} />
        )}
        <p className='text-muted-foreground text-[11px] leading-snug'>
          {t(
            'The model must support function calling / tool use, or the copilot cannot work.'
          )}
        </p>
      </div>

      <div className='flex flex-col gap-1.5'>
        <Label htmlFor={CHANNEL_FIELD_ID} className='text-xs font-medium'>
          {t('Channel')}
        </Label>
        {inner.canConfigure ? (
          <ComboboxInput
            id={CHANNEL_FIELD_ID}
            options={inner.channelOptions}
            value={
              inner.target.channel
                ? String(inner.target.channel.channel_id)
                : ''
            }
            onValueChange={(value) =>
              inner.onChannelChange(Number(value) || COPILOT_AUTO_CHANNEL_ID)
            }
            placeholder={t('Automatic routing (no pinning)')}
            emptyText={t('No channels found')}
          />
        ) : (
          <ReadOnlyValue
            value={
              inner.target.channel
                ? formatCopilotChannel(inner.target.channel)
                : t('Automatic routing (no pinning)')
            }
          />
        )}
        {inner.target.isPinUnservable ? (
          <p className='text-destructive text-[11px] leading-snug'>
            {t(
              'This channel does not serve the selected model. The copilot will fail on the next message.'
            )}
          </p>
        ) : (
          <p className='text-muted-foreground text-[11px] leading-snug'>
            {t(
              'Pinning keeps the copilot on one line, which makes its spend easy to account for.'
            )}
          </p>
        )}
        {inner.canConfigure && inner.target.channel && (
          <Button
            variant='ghost'
            size='sm'
            className='h-7 self-start px-2 text-[11px]'
            disabled={inner.isSaving}
            onClick={() => inner.onChannelChange(COPILOT_AUTO_CHANNEL_ID)}
          >
            {t('Clear pin')}
          </Button>
        )}
      </div>

      {!inner.canConfigure && (
        <p className='text-muted-foreground text-[11px] leading-snug'>
          {t('Changing the copilot model is available to the site owner only.')}
        </p>
      )}
    </div>
  )
}

function ReadOnlyValue(props: { value: string }) {
  return (
    <p
      className='bg-muted/40 truncate rounded-md border px-2 py-1.5 font-mono text-xs'
      title={props.value}
    >
      {props.value}
    </p>
  )
}
