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
import { ChevronRight, Copy } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useTagRegistry } from '@/hooks/use-tag-registry'
import { formatDiscount } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { resolveTagList, sortTagsByProminence } from '@/lib/model-tags'
import { cn } from '@/lib/utils'

import { DEFAULT_TOKEN_UNIT, MAX_CARD_TAGS } from '../constants'
import { getPriceComparison } from '../lib/price-comparison'
import type { PricingModel, TokenUnit } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'
import { PriceComparisonTable } from './price-comparison-table'
import { PromoBadge } from './promo-badge'

export interface ModelCardProps {
  model: PricingModel
  onClick: () => void
  priceRate?: number
  usdExchangeRate?: number
  tokenUnit?: TokenUnit
  showRechargePrice?: boolean
  selectedGroup?: string
}

export const ModelCard = memo(function ModelCard(props: ModelCardProps) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const tagRegistry = useTagRegistry()
  const tokenUnit = props.tokenUnit ?? DEFAULT_TOKEN_UNIT
  const priceRate = props.priceRate ?? 1
  const usdExchangeRate = props.usdExchangeRate ?? 1
  const showRechargePrice = props.showRechargePrice ?? false
  const tags = resolveTagList(props.model.tags, tagRegistry)
  const modelIconKey = props.model.icon || props.model.vendor_icon
  // Scaled with the 48px frame below to hold the same glyph-to-padding ratio:
  // growing the frame alone just adds whitespace and reads as a smaller icon.
  const modelIcon = modelIconKey ? getLobeIcon(modelIconKey, 34) : null
  const initial = props.model.model_name?.charAt(0).toUpperCase() || '?'

  const comparison = getPriceComparison(props.model, {
    tokenUnit,
    showRechargePrice,
    priceRate,
    usdExchangeRate,
    selectedGroup: props.selectedGroup,
    includeCache: false,
  })
  // Per-request models are billed per call, so a "/1M tokens" header would be
  // wrong; the platform column carries no unit for them.
  const unitLabel = comparison.isPerRequest
    ? t('Platform price')
    : `${t('Platform price')}/${tokenUnit}`
  const officialLabel = comparison.isPerRequest
    ? t('Official price')
    : `${t('Official price')}/${tokenUnit}`

  // Offer tags lead the row and animate; capability tags follow, unanimated.
  // Sorting by promo-ness rather than filtering keeps every tag visible.
  // Which tags are offers is now the vocabulary's `kind`, so an operator can
  // make a new tag promotional without a frontend change.
  const visibleTags = sortTagsByProminence(tags).slice(0, MAX_CARD_TAGS)
  const hiddenTagCount = Math.max(tags.length - MAX_CARD_TAGS, 0)

  // The same discount the table's own input row shows, taken from the same
  // comparison, so the pill and the table can never disagree. Absent when this
  // model has no official price to be cheaper than — a card that badged the group
  // ratio instead would be advertising a number measured against this site's own
  // standard price, not against the vendor.
  const discountRatio = comparison.officialDiscountRatio
  const discountText =
    discountRatio == null ? null : formatDiscount(discountRatio, t)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    copyToClipboard(props.model.model_name || '')
  }

  // The whole card opens the details panel, so it has to answer to the keyboard
  // the way a button would. Space is prevented from scrolling the page.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      props.onClick()
    }
  }

  return (
    <div
      role='button'
      tabIndex={0}
      aria-label={props.model.model_name}
      onClick={props.onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group border-border bg-card relative flex cursor-pointer flex-col overflow-hidden rounded-xl border p-4.5',
        // Only the properties that actually move are transitioned: `transition-all`
        // here also animated the price table's own colour changes a beat behind
        // the card, which read as lag.
        'transition-[transform,border-color,box-shadow] duration-200 ease-out',
        'shadow-raised hover:border-primary/40 hover:-translate-y-0.5',
        'hover:shadow-raised-lg',
        'focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0'
      )}
    >
      {/* Decorative scan line: opens from the centre along the top edge on hover.
          It lives in the 1px strip above the padding box, so it never overlaps
          content and needs no stacking order of its own. */}
      <span
        aria-hidden
        className='via-primary pointer-events-none absolute inset-x-0 top-0 h-px scale-x-0 bg-gradient-to-r from-transparent to-transparent transition-transform duration-300 ease-out group-hover:scale-x-100 motion-reduce:transition-none'
      />
      {/* Header: icon + name, with copy as the only top-right affordance so it
          never competes with the model name for width. */}
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 items-start gap-3'>
          {/* Card surface plus a border, not a grey fill: the tint muddied
              vendor logos, most of which already carry their own colour. */}
          <div className='bg-card border-border/80 group-hover:border-primary/35 flex size-12 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200'>
            {modelIcon || (
              <span className='text-muted-foreground text-lg font-bold'>
                {initial}
              </span>
            )}
          </div>
          <div className='min-w-0'>
            {/* Two lines rather than a truncation: at this width
                `claude-opus-4-6` and `claude-opus-4-6-thinking` would both
                clip to the same string. */}
            <h3
              className='text-foreground line-clamp-2 text-base leading-tight font-bold'
              title={props.model.model_name}
            >
              {props.model.model_name}
            </h3>
            {/* Discount and tags read as one metadata row under the name.
                The group badge used to lead this row; it was dropped because
                the group key (`default`) names an internal routing lane that a
                buyer can neither choose nor act on, and its discount duplicated
                the price table directly below. Groups remain in the details
                view, where the per-group price breakdown gives them meaning. */}
            <div className='mt-2.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5'>
              {discountText && (
                <PromoBadge
                  label={discountText}
                  variant='orange'
                  flow
                  title={t('Platform price vs. official price')}
                />
              )}
              {visibleTags.map((tag) => (
                <PromoBadge
                  key={tag.slug}
                  label={tag.label}
                  variant={tag.variant}
                  flow={tag.kind === 'promo'}
                />
              ))}
              {hiddenTagCount > 0 && (
                <span className='text-muted-foreground/45 text-xs'>
                  +{hiddenTagCount}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type='button'
          onClick={handleCopy}
          className='text-muted-foreground/50 hover:text-foreground hover:bg-muted shrink-0 rounded-md p-1.5 transition-colors'
          title={t('Copy')}
        >
          <Copy className='size-3.5' />
        </button>
      </div>

      {/* Price breakdown: platform price vs. list price vs. discount */}
      <PriceComparisonTable
        comparison={comparison}
        unitLabel={unitLabel}
        officialLabel={officialLabel}
        className='group-hover:border-primary/25 mt-4 transition-colors duration-200'
      />

      {/* Description takes the slack so footers align across a grid row.
          An absent description collapses instead of printing a placeholder. */}
      {props.model.description ? (
        <p className='text-muted-foreground/85 mt-3.5 line-clamp-2 flex-1 text-[13px] leading-relaxed'>
          {props.model.description}
        </p>
      ) : (
        <div className='flex-1' />
      )}

      {/* Footer: billing mode on the left, details on the right.
          Raw endpoint types (`openai`, `openai-response`) used to sit here, but
          they name an API dialect for integrators, not anything a person
          choosing a model can act on. They remain in the details view.
          Latency/throughput moved there too. */}
      <div className='mt-4 flex items-center justify-between gap-2'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          {/* Matched to the metadata row's pills: a card with roomy badges up
              top and cramped ones at the bottom reads as two designs. */}
          <ModelBillingModeBadge
            model={props.model}
            filled
            className='h-[26px] px-3 text-[13px]'
          />
        </div>
        {/* Not a button any more: the card itself is the control, and a nested
            button would give the same action two tab stops and two names. It
            stays styled as an affordance so the click target is still obvious. */}
        <span className='text-info border-info/25 group-hover:bg-info/8 group-hover:border-info/45 inline-flex h-[26px] shrink-0 items-center gap-0.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors duration-200'>
          {t('Details')}
          <ChevronRight className='size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0' />
        </span>
      </div>
    </div>
  )
})
