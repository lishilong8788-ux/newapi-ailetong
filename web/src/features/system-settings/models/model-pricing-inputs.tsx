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
import { useTranslation } from 'react-i18next'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

import {
  SettingsControlGroup,
  SettingsSwitchField,
} from '../components/settings-form-layout'

export function PriceInput(props: {
  value: string
  placeholder?: string
  disabled?: boolean
  currencySymbol?: string
  currencySuffix?: string
  onChange: (value: string) => void
}) {
  const symbol = props.currencySymbol ?? '$'
  const suffix = props.currencySuffix ?? `${symbol}/1M`

  return (
    <InputGroup>
      <InputGroupAddon>{symbol}</InputGroupAddon>
      <InputGroupInput
        inputMode='decimal'
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <InputGroupAddon align='inline-end'>{suffix}</InputGroupAddon>
    </InputGroup>
  )
}

export function PriceLane(props: {
  title: string
  description: string
  placeholder: string
  value: string
  enabled: boolean
  disabled?: boolean
  currencySymbol?: string
  currencyLabel?: string
  onEnabledChange: (checked: boolean) => void
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const effectiveDisabled = props.disabled || !props.enabled
  const symbol = props.currencySymbol ?? '$'
  const isUSD = symbol === '$' || props.currencyLabel === 'USD'

  let helpText = t('Disabled lanes are omitted on save.')
  if (props.enabled) {
    helpText = isUSD
      ? t('USD price per 1M tokens.')
      : t('Price per 1M tokens ({{currency}}).', {
          currency: props.currencyLabel ?? symbol,
        })
  }

  return (
    <SettingsControlGroup
      className={cn('space-y-3', effectiveDisabled && 'opacity-75')}
      data-disabled={effectiveDisabled || undefined}
    >
      <SettingsSwitchField
        checked={props.enabled}
        disabled={props.disabled}
        onCheckedChange={props.onEnabledChange}
        label={props.title}
        description={props.description}
        aria-label={props.title}
      />
      <PriceInput
        value={props.value}
        placeholder={props.placeholder}
        disabled={effectiveDisabled}
        currencySymbol={symbol}
        onChange={props.onChange}
      />
      <p className='text-muted-foreground text-xs'>{helpText}</p>
    </SettingsControlGroup>
  )
}
