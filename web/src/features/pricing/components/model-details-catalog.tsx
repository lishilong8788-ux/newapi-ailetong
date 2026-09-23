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
import { ChevronDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import {
  CAPABILITY_LABEL_KEYS,
  formatCatalogTokenCount,
  formatCatalogYearMonth,
  normalizeCatalogItems,
} from '../lib/catalog-fields'
import type { ModelCapability, PricingModel } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'
import {
  CatalogPillList,
  FieldPlaceholder,
  ModalityLabels,
  SectionTitle,
} from './model-details-shared'

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

  // Says so rather than rendering nothing: this tab is where a reader comes to
  // look the model up, and a silently missing blurb is indistinguishable from a
  // page that failed to load the one it has. One muted line, not a card of its
  // own — an absent blurb should cost a line, not a block.
  if (!description) {
    return (
      <p className='text-muted-foreground/50 text-sm'>
        {t('No description has been added for this model yet.')}
      </p>
    )
  }

  return (
    <div>
      <p
        ref={textRef}
        className={cn(
          'text-muted-foreground text-sm leading-relaxed',
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
// Reference sheet
// ----------------------------------------------------------------------------

/**
 * One label/value line of the reference sheet.
 *
 * Label left, value right, on a card-white cell whose 1px gaps come from the
 * grid's own fill. `wide` spans both columns, for the fields whose value is a
 * wrapping pill list rather than a single figure.
 */
function CatalogField(props: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'bg-card flex min-w-0 items-start justify-between gap-3 px-3.5 py-2.5',
        props.wide && 'sm:col-span-2'
      )}
    >
      <span className='text-muted-foreground shrink-0 pt-0.5 text-xs font-medium'>
        {props.label}
      </span>
      <div className='flex min-w-0 flex-col items-end gap-1 text-right'>
        {props.children}
      </div>
    </div>
  )
}

function CatalogFigure(props: { children: React.ReactNode }) {
  return (
    <span className='text-foreground min-w-0 truncate text-sm font-semibold tabular-nums'>
      {props.children}
    </span>
  )
}

/**
 * Everything the catalog knows about the model, as one sheet.
 *
 * This was three blocks — a hero spec strip, a capabilities card, and a
 * six-cell info grid — which between them asked the same question ("what is
 * this model?") in three visual languages and, because `/api/pricing` serves
 * almost none of these fields yet, answered it mostly in em dashes. Three
 * frames' worth of chrome around a handful of facts read as repetition rather
 * than structure, so they are one hairline grid of uniform label/value lines:
 * an unset field now costs a line instead of a block.
 *
 * Fields stay visible when unset, as before — an operator should be able to see
 * which catalog fields are still blank rather than guess whether the block
 * exists. Provider and tags are gone: both are pills in the masthead directly
 * above, which is read on every tab.
 */
export function ModelDetailsCatalog(props: { model: PricingModel }) {
  const { t } = useTranslation()
  const model = props.model
  const inputModalities = normalizeCatalogItems(model.input_modalities)
  const outputModalities = normalizeCatalogItems(model.output_modalities)
  const capabilities = normalizeCatalogItems(model.capabilities)
  const groups = normalizeCatalogItems(model.enable_groups)
  const endpoints = normalizeCatalogItems(model.supported_endpoint_types)
  const context = formatCatalogTokenCount(model.context_length)
  const maxOutput = formatCatalogTokenCount(model.max_output_tokens)
  const knowledgeCutoff = formatCatalogYearMonth(model.knowledge_cutoff)
  const released = formatCatalogYearMonth(model.release_date)
  const hasModalities =
    inputModalities.length > 0 || outputModalities.length > 0

  return (
    <section>
      <SectionTitle>{t('Model information')}</SectionTitle>
      {/* Hairline grid: the container's own fill *is* the 1px gap between cells,
          so this keeps `bg-border/60` instead of `DetailsCard`'s card white.
          Border and shadow are the card's, so it still lands on the tray as one. */}
      <div className='bg-border/60 border-border/70 shadow-raised grid grid-cols-1 gap-px overflow-hidden rounded-xl border sm:grid-cols-2'>
        {/* The blurb is the one cell with no label: it is prose, and "描述: …"
            above a paragraph states what the paragraph plainly is. */}
        <div className='bg-card min-w-0 px-3.5 py-3 sm:col-span-2'>
          <ModelDescription model={model} />
        </div>

        <CatalogField label={t('Context')}>
          <CatalogFigure>{context || <FieldPlaceholder />}</CatalogFigure>
          <span className='text-muted-foreground/70 text-[11px]'>
            {t('Maximum input window')}
          </span>
        </CatalogField>
        <CatalogField label={t('Max output')}>
          <CatalogFigure>{maxOutput || <FieldPlaceholder />}</CatalogFigure>
          <span className='text-muted-foreground/70 text-[11px]'>
            {t('Maximum tokens per response')}
          </span>
        </CatalogField>
        <CatalogField label={t('Modalities')}>
          <CatalogFigure>
            {hasModalities ? (
              <span className='inline-flex items-center gap-1'>
                <ModalityLabels items={inputModalities} />
                {inputModalities.length > 0 && outputModalities.length > 0 && (
                  <span className='text-muted-foreground/40'>→</span>
                )}
                <ModalityLabels items={outputModalities} />
              </span>
            ) : (
              <FieldPlaceholder />
            )}
          </CatalogFigure>
        </CatalogField>
        <CatalogField label={t('Parameters')}>
          <CatalogFigure>
            {model.parameter_count || <FieldPlaceholder />}
          </CatalogFigure>
        </CatalogField>
        <CatalogField label={t('Knowledge cutoff')}>
          <CatalogFigure>
            {knowledgeCutoff || <FieldPlaceholder />}
          </CatalogFigure>
        </CatalogField>
        <CatalogField label={t('Released')}>
          <CatalogFigure>{released || <FieldPlaceholder />}</CatalogFigure>
        </CatalogField>

        <CatalogField label={t('Type')} wide>
          <ModelBillingModeBadge model={model} />
        </CatalogField>
        <CatalogField label={t('Capabilities')} wide>
          {capabilities.length > 0 ? (
            <CatalogPillList
              className='justify-end'
              items={capabilities.map((capability) =>
                t(
                  CAPABILITY_LABEL_KEYS[capability as ModelCapability] ??
                    capability
                )
              )}
            />
          ) : (
            <FieldPlaceholder className='text-sm' />
          )}
        </CatalogField>
        <CatalogField label={t('Endpoints')} wide>
          {endpoints.length > 0 ? (
            <CatalogPillList className='justify-end' items={endpoints} />
          ) : (
            <FieldPlaceholder className='text-sm' />
          )}
        </CatalogField>
        <CatalogField label={t('Groups')} wide>
          {groups.length > 0 ? (
            <CatalogPillList className='justify-end' items={groups} />
          ) : (
            <FieldPlaceholder className='text-sm' />
          )}
        </CatalogField>
      </div>
    </section>
  )
}

