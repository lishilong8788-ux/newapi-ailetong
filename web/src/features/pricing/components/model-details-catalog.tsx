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
  CAPABILITY_LABEL_KEYS,
  normalizeCatalogItems,
} from '../lib/catalog-fields'
import { parseTags } from '../lib/filters'
import type { ModelCapability, PricingModel } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'
import {
  CatalogPillList,
  FieldPlaceholder,
  ModalityLabels,
  SectionTitle,
} from './model-details-shared'

function CatalogTextValue(props: { children: React.ReactNode }) {
  return (
    <span className='text-foreground min-w-0 truncate text-sm font-semibold'>
      {props.children}
    </span>
  )
}

function CatalogInfoCell(props: { label: string; children: React.ReactNode }) {
  return (
    <div className='bg-card flex min-w-0 flex-col gap-1 px-3 py-2.5'>
      <span className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
        {props.label}
      </span>
      {props.children}
    </div>
  )
}

/**
 * Capabilities and supported modalities.
 *
 * Rendered even when empty — all three fields are unserved by `/api/pricing`
 * today, and an operator looking at this page should be able to see which
 * catalog fields are still blank rather than wonder whether the block exists.
 */
function ModelCapabilitiesSection(props: { model: PricingModel }) {
  const { t } = useTranslation()
  const capabilities = normalizeCatalogItems(props.model.capabilities)
  const inputModalities = normalizeCatalogItems(props.model.input_modalities)
  const outputModalities = normalizeCatalogItems(props.model.output_modalities)

  return (
    <section>
      <SectionTitle>
        {t('Capabilities')} / {t('Supported modalities')}
      </SectionTitle>
      {/* Card surface, and the two modality boxes below it sit at canvas level:
          page → card → well. Without a fill this had a card's outline but none
          of its substance once the page canvas stopped being white. */}
      <div className='bg-card grid gap-3 rounded-xl border p-3 @2xl/details:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]'>
        {capabilities.length > 0 ? (
          <CatalogPillList
            items={capabilities.map((capability) =>
              t(
                CAPABILITY_LABEL_KEYS[capability as ModelCapability] ??
                  capability
              )
            )}
          />
        ) : (
          <p className='text-muted-foreground/50 self-center text-sm'>
            {t('No capability tags configured yet.')}
          </p>
        )}
        <div className='grid gap-2 sm:grid-cols-2'>
          <div className='bg-canvas flex items-center justify-between gap-3 rounded-lg border px-3 py-2'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Input')}
            </span>
            <CatalogTextValue>
              {inputModalities.length > 0 ? (
                <ModalityLabels items={inputModalities} />
              ) : (
                <FieldPlaceholder />
              )}
            </CatalogTextValue>
          </div>
          <div className='bg-canvas flex items-center justify-between gap-3 rounded-lg border px-3 py-2'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Output')}
            </span>
            <CatalogTextValue>
              {outputModalities.length > 0 ? (
                <ModalityLabels items={outputModalities} />
              ) : (
                <FieldPlaceholder />
              )}
            </CatalogTextValue>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Six-cell reference grid: provider, billing mode, groups, endpoints, tags, size. */
function ModelInfoSection(props: { model: PricingModel }) {
  const { t } = useTranslation()
  const model = props.model
  const groups = normalizeCatalogItems(model.enable_groups)
  const endpoints = normalizeCatalogItems(model.supported_endpoint_types)
  const tags = parseTags(model.tags)

  return (
    <section>
      <SectionTitle>{t('Model information')}</SectionTitle>
      <div className='bg-border/60 grid grid-cols-1 gap-px overflow-hidden rounded-xl border sm:grid-cols-2'>
        <CatalogInfoCell label={t('Provider')}>
          <CatalogTextValue>
            {model.vendor_name || <FieldPlaceholder />}
          </CatalogTextValue>
        </CatalogInfoCell>
        <CatalogInfoCell label={t('Type')}>
          <div className='flex min-w-0'>
            <ModelBillingModeBadge model={model} />
          </div>
        </CatalogInfoCell>
        <CatalogInfoCell label={t('Groups')}>
          {groups.length > 0 ? (
            <CatalogPillList items={groups} />
          ) : (
            <FieldPlaceholder className='text-sm' />
          )}
        </CatalogInfoCell>
        <CatalogInfoCell label={t('Endpoints')}>
          {endpoints.length > 0 ? (
            <CatalogPillList items={endpoints} />
          ) : (
            <FieldPlaceholder className='text-sm' />
          )}
        </CatalogInfoCell>
        <CatalogInfoCell label={t('Tags')}>
          {tags.length > 0 ? (
            <CatalogPillList items={tags} />
          ) : (
            <FieldPlaceholder className='text-sm' />
          )}
        </CatalogInfoCell>
        <CatalogInfoCell label={t('Parameters')}>
          <CatalogTextValue>
            {model.parameter_count || <FieldPlaceholder />}
          </CatalogTextValue>
        </CatalogInfoCell>
      </div>
    </section>
  )
}

/** Descriptive (non-price) reference blocks at the foot of the Overview tab. */
export function ModelDetailsCatalog(props: { model: PricingModel }) {
  return (
    <>
      <ModelCapabilitiesSection model={props.model} />
      <ModelInfoSection model={props.model} />
    </>
  )
}
