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
import {
  CalendarClock,
  ChevronDown,
  FileText,
  Layers,
  Maximize2,
  Sparkles,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { formatDiscount } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import { DEFAULT_TAG_VARIANT, PROMO_TAGS, TAG_VARIANTS } from '../constants'
import {
  formatCatalogTokenCount,
  formatCatalogYearMonth,
  normalizeCatalogItems,
} from '../lib/catalog-fields'
import { parseTags } from '../lib/filters'
import { getPriceComparison } from '../lib/price-comparison'
import type { PricingModel, TokenUnit } from '../types'
import { FieldPlaceholder, ModalityLabels } from './model-details-shared'
import { PromoBadge } from './promo-badge'

// ----------------------------------------------------------------------------
// Description
// ----------------------------------------------------------------------------

/** Lines shown before the description collapses behind a toggle. */
const DESCRIPTION_CLAMP_LINES = 3

/**
 * The model's own blurb, falling back to the vendor's.
 *
 * Clamped to three lines with a toggle, and the toggle only appears when the
 * text actually overflows — measured rather than guessed from length, because
 * the drawer is resizable and the same string overflows at 400px but not at
 * 900px. Overflow is only ever measured while collapsed: once expanded the
 * element is its full height, so a naive re-measure would decide there is
 * nothing to collapse and strip the control the reader needs to get back.
 */
function ModelDescription(props: { model: PricingModel }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  const description =
    props.model.description || props.model.vendor_description || ''

  useLayoutEffect(() => {
    setExpanded(false)
  }, [description])

  useEffect(() => {
    const element = textRef.current
    if (!element || expanded) return

    const measure = () => {
      // 1px of tolerance: sub-pixel line heights make scrollHeight exceed
      // clientHeight by a fraction on text that visually fits exactly.
      setOverflows(element.scrollHeight - element.clientHeight > 1)
    }
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [description, expanded])

  if (!description) {
    return (
      <p className='text-muted-foreground/50 mt-3 text-sm'>
        {t('No description has been added for this model yet.')}
      </p>
    )
  }

  return (
    <div className='mt-3'>
      <p
        ref={textRef}
        className={cn(
          'text-muted-foreground text-[15px] leading-relaxed',
          !expanded && 'line-clamp-3'
        )}
        style={
          expanded ? undefined : { WebkitLineClamp: DESCRIPTION_CLAMP_LINES }
        }
      >
        {description}
      </p>
      {(overflows || expanded) && (
        <button
          type='button'
          onClick={() => setExpanded((value) => !value)}
          className='text-info hover:text-info/80 mt-1 inline-flex items-center gap-0.5 text-xs font-medium transition-colors'
          aria-expanded={expanded}
        >
          {expanded ? t('Collapse') : t('Expand')}
          <ChevronDown
            className={cn(
              'size-3 transition-transform duration-200',
              expanded && 'rotate-180'
            )}
          />
        </button>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Spec strip
// ----------------------------------------------------------------------------

/**
 * Five fixed cells of objective model specs.
 *
 * Fixed on purpose: none of these fields is served by `/api/pricing` yet, and a
 * strip that hid its empty cells would render as nothing today and rearrange
 * itself later, field by field, as the backend catches up. Placeholders keep the
 * shape final and make the gaps legible.
 */
function ModelSpecStrip(props: { model: PricingModel }) {
  const { t } = useTranslation()
  const model = props.model
  const inputModalities = normalizeCatalogItems(model.input_modalities)
  const outputModalities = normalizeCatalogItems(model.output_modalities)
  const context = formatCatalogTokenCount(model.context_length)
  const maxOutput = formatCatalogTokenCount(model.max_output_tokens)
  const knowledgeCutoff = formatCatalogYearMonth(model.knowledge_cutoff)
  const released = formatCatalogYearMonth(model.release_date)
  const hasModalities =
    inputModalities.length > 0 || outputModalities.length > 0

  const cells: {
    key: string
    icon: React.ComponentType<{ className?: string }>
    label: string
    value: React.ReactNode
    hint?: string
  }[] = [
    {
      key: 'context',
      icon: Layers,
      label: t('Context'),
      value: context || <FieldPlaceholder />,
      hint: t('Maximum input window'),
    },
    {
      key: 'max-output',
      icon: Maximize2,
      label: t('Max output'),
      value: maxOutput || <FieldPlaceholder />,
      hint: t('Maximum tokens per response'),
    },
    {
      key: 'modalities',
      icon: FileText,
      label: t('Modalities'),
      value: hasModalities ? (
        <span className='inline-flex items-center gap-1'>
          <ModalityLabels items={inputModalities} />
          {inputModalities.length > 0 && outputModalities.length > 0 && (
            <span className='text-muted-foreground/40'>→</span>
          )}
          <ModalityLabels items={outputModalities} />
        </span>
      ) : (
        <FieldPlaceholder />
      ),
    },
    {
      key: 'knowledge',
      icon: Sparkles,
      label: t('Knowledge cutoff'),
      value: knowledgeCutoff || <FieldPlaceholder />,
    },
    {
      key: 'release',
      icon: CalendarClock,
      label: t('Released'),
      value: released || <FieldPlaceholder />,
    },
  ]

  return (
    <div className='bg-border/60 mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border @md/details:grid-cols-3 @2xl/details:grid-cols-5'>
      {cells.map((cell) => {
        const Icon = cell.icon
        return (
          <div
            key={cell.key}
            className='bg-card flex min-w-0 flex-col gap-1 px-3.5 py-3.5'
          >
            <span className='text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium'>
              <Icon className='size-4 shrink-0' />
              <span className='truncate'>{cell.label}</span>
            </span>
            <span className='text-foreground truncate text-lg font-bold tabular-nums'>
              {cell.value}
            </span>
            <span className='text-muted-foreground/70 truncate text-xs'>
              {cell.hint ?? ' '}
            </span>
          </div>
        )
      })}
    </div>
  )
}

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
}

/**
 * Identity block above the tabs: who this model is, what it costs at a glance,
 * and what it can do.
 *
 * The billing-mode badge deliberately does not appear here — every price table
 * below carries it, and stating it twice on one screen buys nothing. Tags come
 * up from the old bottom metadata grid because "限时 / 推荐" is the kind of thing
 * a buyer reads with the name, not after the endpoint list.
 */
export function ModelDetailsHeader(props: ModelDetailsHeaderProps) {
  const { t } = useTranslation()
  const model = props.model
  const modelIconKey = model.icon || model.vendor_icon
  const modelIcon = modelIconKey ? getLobeIcon(modelIconKey, 22) : null
  const tags = parseTags(model.tags)
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
    <header>
      <div className='flex items-start gap-3'>
        {modelIcon && (
          <div className='bg-card border-border/80 mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border'>
            {modelIcon}
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <h1 className='min-w-0 font-mono text-xl font-bold tracking-tight break-all sm:text-2xl'>
              {model.model_name}
            </h1>
            <CopyButton
              value={model.model_name || ''}
              className='size-6 shrink-0'
              iconClassName='size-3'
              tooltip={t('Copy model name')}
              successTooltip={t('Copied!')}
              aria-label={t('Copy model name')}
            />
          </div>

          <div className='mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5'>
            {model.vendor_name && (
              <span className='text-muted-foreground text-sm'>
                {model.vendor_name}
              </span>
            )}
            {discountText && (
              <PromoBadge
                label={discountText}
                variant='orange'
                flow
                title={t('Platform price vs. official price')}
              />
            )}
            {tags.map((tag) => (
              <PromoBadge
                key={tag}
                label={tag}
                variant={TAG_VARIANTS[tag.toLowerCase()] ?? DEFAULT_TAG_VARIANT}
                flow={PROMO_TAGS.has(tag.toLowerCase())}
              />
            ))}
          </div>
        </div>
      </div>

      <ModelDescription model={model} />
      <ModelSpecStrip model={model} />
    </header>
  )
}
