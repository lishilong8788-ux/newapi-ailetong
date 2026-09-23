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

import { CopyButton } from '@/components/copy-button'
import { useTagRegistry } from '@/hooks/use-tag-registry'
import { formatDiscount } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { resolveTagList } from '@/lib/model-tags'
import { cn } from '@/lib/utils'

import { getPriceComparison } from '../lib/price-comparison'
import type { PricingModel, TokenUnit } from '../types'
import { PromoBadge } from './promo-badge'

// ----------------------------------------------------------------------------
// Header
// ----------------------------------------------------------------------------

export interface ModelDetailsHeaderProps {
  model: PricingModel
  /** Active group filter, so the headline discount matches the price table. */
  selectedGroup?: string
  /**
   * The same display settings the price tables below are rendered with. The
   * headline discount is platform ÷ official, and the recharge rate moves the
   * platform side — without these the badge would quote a different discount
   * from the table it sits above.
   */
  tokenUnit: TokenUnit
  priceRate: number
  usdExchangeRate: number
  showRechargePrice?: boolean
  /**
   * Drawer mode: the band is the panel's fixed top bar rather than the first
   * thing in a scrolling column. It keeps its own horizontal padding (the drawer
   * body no longer supplies any), reserves room on the right for the drawer's
   * close button, and stays one line tall so the content below gets the height.
   */
  docked?: boolean
  /**
   * Right-hand slot, used for the tab switcher. It rides in the identity bar
   * instead of a second row of its own: a pinned bar that only holds a name
   * wastes the height twice, once on the bar and once on the strip under it.
   */
  trailing?: ReactNode
}

/**
 * Masthead above the tabs: the model's identity, and nothing else.
 *
 * Deliberately not a card. A bordered box floating inside the drawer's padding
 * reads as a widget someone dropped on the page; the band bleeds to all three
 * edges instead and separates itself with a hairline under it and a single accent
 * rule along the top, so the drawer opens on the model's name rather than on a
 * frame around it. Identity sits left, commercial standing (vendor, headline
 * discount, offer tags) right — the eye lands on what the model *is*, then
 * travels to what it *costs*, and the right column stops the wide drawer from
 * leaving half the band empty.
 *
 * The blurb and the spec grid deliberately live in the Basic Info tab instead:
 * this band is read on every tab, and prose that only matters once belongs where
 * the reader goes looking for it. The billing-mode badge is likewise absent —
 * every price table below carries it.
 *
 * In the drawer the band is pinned and the tab switcher rides in it (`trailing`),
 * which is why everything here is sized to one line: whatever height this takes
 * is height the price tables never get back.
 */
export function ModelDetailsHeader(props: ModelDetailsHeaderProps) {
  const { t } = useTranslation()
  const tagRegistry = useTagRegistry()
  const model = props.model
  const modelIconKey = model.icon || model.vendor_icon
  const modelIcon = modelIconKey ? getLobeIcon(modelIconKey, 26) : null
  // Not sorted by prominence: the details panel shows every tag, so there is no
  // truncation for an offer tag to be pushed out of.
  const tags = resolveTagList(model.tags, tagRegistry)
  // Platform ÷ official, not the group ratio: the group ratio compares this
  // group against this site's own standard price, which says nothing about
  // whether the model is cheaper here than from the vendor.
  const discountRatio = getPriceComparison(model, {
    tokenUnit: props.tokenUnit,
    showRechargePrice: props.showRechargePrice,
    priceRate: props.priceRate,
    usdExchangeRate: props.usdExchangeRate,
    selectedGroup: props.selectedGroup,
  }).officialDiscountRatio
  const discountText =
    discountRatio == null ? null : formatDiscount(discountRatio, t)

  return (
    <header
      className={cn(
        // Saturated brand band, not another white bar. The panel opens on colour
        // and the white cards in the tray below read as sitting *in* something
        // rather than continuing the header. No hairline under it — the band
        // already ends itself against the tinted tray.
        'from-band-start to-band-end relative shrink-0 bg-linear-to-br text-white',
        // Room on the right for the drawer's own close button (top-3 right-3,
        // 32px wide), so the trailing tabs stop short of it instead of sliding
        // under. No top padding: the bar is the first thing in the panel now, and
        // the button sits inside its height rather than above it.
        props.docked
          ? 'px-4 pr-13 sm:px-6 sm:pr-14'
          : // Standalone the band is not flush to a panel edge, so it rounds into
            // a hero block instead of bleeding into the page's own padding.
            'rounded-2xl px-4 sm:px-6'
      )}
    >
      {/* Soft highlight off the top-right, the one piece of the reference band's
          lighting that is safe to keep: it lifts the corner the eye reads as
          "glossy" without lightening the left side where the name sits. Capped at
          18% white — the gradient stops are pinned just above the AA floor for
          white text, so anything stronger here would spend that margin.
          Pointer-events off: it spans the whole band, including the drawer's
          close button, and would otherwise swallow its clicks. */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] bg-[radial-gradient(circle_at_78%_-40%,rgba(255,255,255,0.18),transparent_62%)]'
      />

      <div
        className={cn(
          'relative flex flex-wrap items-center gap-x-4 gap-y-2',
          props.docked ? 'py-2.5' : 'justify-between py-4 sm:py-5'
        )}
      >
        <div
          className={cn(
            'flex min-w-0 items-center',
            props.docked ? 'gap-2.5' : 'flex-1 gap-3'
          )}
        >
          {/* Frosted tile rather than the old muted-grey one: on the band a grey
              fill reads as a hole punched in the colour. White at 15% with a
              brighter hairline is the same tile the reference uses for the marks
              in its hero. Most vendor logos are dark-on-transparent, so the tile
              has to stay light enough to hold one. */}
          {modelIcon && (
            <div
              className={cn(
                'flex shrink-0 items-center justify-center rounded-xl bg-white/90 ring-1 ring-white/40',
                props.docked ? 'size-9' : 'size-11'
              )}
            >
              {modelIcon}
            </div>
          )}
          <div className='flex min-w-0 items-center gap-2'>
            {/* Truncated in the pinned bar, wrapped otherwise: a long name may
                take two lines in a band that scrolls away, but not in one that
                every tab is read through. The full string is a click away on the
                copy button and spelled out in Basic Info. */}
            <h1
              className={cn(
                'min-w-0 font-mono font-bold tracking-tight',
                props.docked
                  ? 'truncate text-lg'
                  : 'text-xl break-all sm:text-[1.6rem] sm:leading-8'
              )}
            >
              {model.model_name}
            </h1>
            <CopyButton
              value={model.model_name || ''}
              className='size-6 shrink-0 text-white/70 hover:bg-white/15 hover:text-white'
              iconClassName='size-3'
              tooltip={t('Copy model name')}
              successTooltip={t('Copied!')}
              aria-label={t('Copy model name')}
            />
          </div>
        </div>

        {/* Right cluster. `justify-end` only from sm: on a phone the band is one
            column and the badges read better flush-left under the name than
            pushed to an edge the title does not reach. */}
        <div
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5',
            !props.docked && 'sm:justify-end'
          )}
        >
          {/* Vendor pill is outline only, no fill. A `bg-white/15` lightens the
              band under the label to ~2.9:1 against white, which 12px text cannot
              carry; unfilled, the label sits on the band itself at 4.76:1. */}
          {model.vendor_name && (
            <span className='inline-flex max-w-full items-center rounded-full border border-white/35 px-2.5 py-0.5 text-xs font-medium text-white'>
              <span className='truncate'>{model.vendor_name}</span>
            </span>
          )}
          {discountText && (
            <PromoBadge
              label={discountText}
              variant='orange'
              flow
              onBand
              title={t('Platform price vs. official price')}
            />
          )}
          {tags.map((tag) => (
            <PromoBadge
              key={tag.slug}
              label={tag.label}
              variant={tag.variant}
              flow={tag.kind === 'promo'}
              onBand
            />
          ))}
        </div>

        {/* `ms-auto` from sm so the switcher holds the far right of the bar
            whether or not the badges filled the middle. Below that it takes its
            own full-width line, where three tab labels do not fit beside a model
            name. */}
        {props.trailing && (
          <div className='w-full min-w-0 sm:ms-auto sm:w-auto'>
            {props.trailing}
          </div>
        )}
      </div>
    </header>
  )
}
