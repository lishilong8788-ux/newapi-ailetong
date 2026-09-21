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
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatCurrencyFromUSD } from '@/lib/currency'
import { cn } from '@/lib/utils'

import { getChannelLabel, toChannelPricedModel } from '../lib/channel-price'
import { getTokenUnitPrice } from '../lib/price'
import type {
  AutoRouteInfo,
  ChannelRoute,
  PricingModel,
  TokenUnit,
} from '../types'
import { SectionTitle } from './model-details-shared'

export interface AutoRouteSettingsProps {
  model: PricingModel
  routes: ChannelRoute[]
  autoRoute?: AutoRouteInfo
  priceRate: number
  usdExchangeRate: number
  tokenUnit: TokenUnit
  showRechargePrice?: boolean
  /** Admins get a link to the setting that governs this; others do not. */
  canManage?: boolean
}

/**
 * The routing policy in force for this model, plus the candidate order.
 *
 * Read-only by design. The switch behind this
 * (`route_setting.auto_route_enabled`) is a single instance-wide option, so
 * rendering it as a toggle here would either be a control that silently does
 * nothing for a normal user, or one that lets any reader re-route the whole
 * site's traffic. Admins get a link to where it actually lives instead.
 */
export function AutoRouteSettings(props: AutoRouteSettingsProps) {
  const { t } = useTranslation()

  if (props.routes.length === 0) return null

  const enabled = Boolean(props.autoRoute?.enabled)
  const pricePreferred = enabled && Boolean(props.autoRoute?.ranked)

  // Three states, not two: the switch can be on while this particular model has
  // no price difference to order on, and saying "lowest price first" there would
  // promise an ordering the router is not applying.
  let policyExplanationKey =
    "Lowest-price routing is off, so the operator's channel order decides."
  if (pricePreferred) {
    policyExplanationKey =
      'This is an instance-wide setting: every model whose channels have distinguishable prices is routed lowest-price-first.'
  } else if (enabled) {
    policyExplanationKey =
      "Lowest-price routing is on, but this model's channels have no configured price difference to order on, so the operator's channel order decides."
  }

  return (
    <section>
      <SectionTitle>{t('Automatic routing settings')}</SectionTitle>

      <div className='bg-card rounded-xl border p-3'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold',
              pricePreferred
                ? 'bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400'
                : 'bg-muted/60 text-muted-foreground'
            )}
          >
            <Settings2 className='size-3' aria-hidden />
            {pricePreferred ? t('Lowest price mode') : t('Manual order mode')}
          </span>
          <span className='text-muted-foreground text-xs'>
            {enabled ? t('Enabled') : t('Disabled')}
          </span>
        </div>

        <p className='text-muted-foreground mt-1.5 text-xs leading-relaxed'>
          {t(policyExplanationKey)}
        </p>

        <div className='mt-2.5'>
          <div className='text-muted-foreground/70 mb-1 text-[11px] font-medium'>
            {t('Candidate order')}
          </div>
          <ol className='space-y-1'>
            {props.routes.map((route, index) => {
              const channelModel = toChannelPricedModel(props.model, route)
              const inputPrice = getTokenUnitPrice(
                channelModel,
                'input',
                props.tokenUnit,
                props.showRechargePrice ?? false,
                props.priceRate,
                props.usdExchangeRate,
                1
              )
              return (
                <li
                  key={route.channel_id}
                  className='flex items-center justify-between gap-2 text-xs'
                >
                  <span className='flex min-w-0 items-center gap-1.5'>
                    <span className='text-muted-foreground/50 w-3 shrink-0 text-right font-mono tabular-nums'>
                      {index + 1}
                    </span>
                    <span className='text-foreground truncate font-mono'>
                      {getChannelLabel(route)}
                    </span>
                  </span>
                  <span className='text-muted-foreground shrink-0 font-mono tabular-nums'>
                    {formatCurrencyFromUSD(inputPrice, {
                      digitsLarge: 4,
                      digitsSmall: 6,
                      abbreviate: false,
                    })}
                    {`/${props.tokenUnit}`}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>

        {props.canManage && (
          <Link
            to='/system-settings/models/$section'
            params={{ section: 'routing-reliability' }}
            className='text-primary mt-2.5 inline-block text-xs hover:underline'
          >
            {t('View all settings')}
          </Link>
        )}
      </div>
    </section>
  )
}
