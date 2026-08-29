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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { isTokenBasedModel } from '@/features/pricing/lib/model-helpers'
import {
  formatPrice,
  formatRequestPrice,
  stripTrailingZeros,
} from '@/features/pricing/lib/price'
import { useStatus } from '@/hooks/use-status'

import type { ModelOption } from '../../types'

type ModelPriceNoteProps = {
  selectedModel?: ModelOption
  /** Group the request will be sent under; its ratio is part of the quote. */
  groupValue: string
  /**
   * Shown when no rate can be computed. Passed in rather than decided by the
   * caller because "can this be quoted?" is only answerable here, and a caller
   * holding a JSX element cannot test it with `??`.
   */
  fallback?: ReactNode
}

/**
 * The real per-token rate for the selected model, in place of the old
 * `Billed per token` label.
 *
 * That label answered a question nobody asks — every model in a token-billed
 * gateway is billed per token — while the question customers do ask on every
 * model ("what does this cost?") had no answer on screen, even though
 * `/api/pricing` was already fetched for icons and vendor names and carries the
 * ratios needed to compute it.
 *
 * Renders nothing when the price cannot be computed rather than showing a
 * placeholder: a model with no catalog entry still has to work, and `formatPrice`
 * already returns `-`/`NaN`-derived output for rows it cannot quote.
 */
export function ModelPriceNote({
  selectedModel,
  groupValue,
  fallback = null,
}: ModelPriceNoteProps) {
  const { t } = useTranslation()
  const { status } = useStatus()

  const entry = selectedModel?.pricing
  if (!entry) return fallback

  // Backstop, not a live path: `buildModelCatalog` keeps unpriced models out of
  // the picker, so a selected model should never reach here with this flag set.
  //
  // Kept because the failure it prevents shipped once. With no configured rate,
  // `model_ratio` holds the 37.5 sentinel, and this component multiplies it into
  // a confident "$75 / $75 per M tokens" — a quote for a request the relay
  // refuses outright. One line here means a future second catalog path cannot
  // reintroduce that by forgetting the filter.
  if (entry.price_unset) return fallback

  // Same clamping the pricing page applies, for the same reason: a zero rate
  // would divide by zero inside the currency conversion.
  const priceRate = Math.max((status?.price as number) ?? 1, 0.001)
  const usdExchangeRate = Math.max(
    (status?.usd_exchange_rate as number) ?? priceRate,
    0.001
  )

  // A request-billed model with no `model_price` formats as `$0`, which would
  // read as "free" rather than "not priced yet". Checked on the source value
  // because the formatted string cannot distinguish the two.
  if (!isTokenBasedModel(entry) && !entry.model_price) return fallback

  const quote = isTokenBasedModel(entry)
    ? {
        input: stripTrailingZeros(
          formatPrice(
            entry,
            'input',
            'M',
            true,
            priceRate,
            usdExchangeRate,
            groupValue
          )
        ),
        output: stripTrailingZeros(
          formatPrice(
            entry,
            'output',
            'M',
            true,
            priceRate,
            usdExchangeRate,
            groupValue
          )
        ),
      }
    : {
        request: stripTrailingZeros(
          formatRequestPrice(
            entry,
            true,
            priceRate,
            usdExchangeRate,
            groupValue
          )
        ),
      }

  const isUnquotable =
    'request' in quote
      ? !quote.request || quote.request === '-'
      : !quote.input ||
        quote.input === '-' ||
        !quote.output ||
        quote.output === '-'

  if (isUnquotable) return fallback

  const label =
    'request' in quote
      ? t('{{price}} per request', { price: quote.request })
      : t('{{input}} in / {{output}} out per 1M tokens', {
          input: quote.input,
          output: quote.output,
        })

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className='text-muted-foreground/80 hidden shrink-0 cursor-default px-1 text-[11.5px] tabular-nums sm:inline' />
        }
      >
        · {label}
      </TooltipTrigger>
      <TooltipContent className='max-w-64'>
        <p>
          {t(
            'Your effective rate, including the group multiplier and any top-up discount.'
          )}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
