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
import { ChevronDown, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useTagRegistry } from '@/hooks/use-tag-registry'
import { getLobeIcon } from '@/lib/lobe-icon'
import { resolveTag, resolveTagList } from '@/lib/model-tags'
import { cn } from '@/lib/utils'

import {
  ENDPOINT_TYPES,
  FILTER_ALL,
  PRICING_FILTER_SCALE,
  QUOTA_TYPES,
  getEndpointTypeLabels,
  getQuotaTypeLabels,
} from '../constants'
import { formatGroupRatio } from '../lib/price'
import type { PricingModel, PricingVendor } from '../types'

type FilterOption = {
  value: string
  label: string
  count?: number
  suffix?: string
  icon?: ReactNode
}

type FilterSectionProps = {
  title: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}

export interface PricingSidebarProps {
  quotaTypeFilter: string
  endpointTypeFilter: string
  vendorFilter: string
  groupFilter: string
  tagFilter: string
  onQuotaTypeChange: (value: string) => void
  onEndpointTypeChange: (value: string) => void
  onVendorChange: (value: string) => void
  onGroupChange: (value: string) => void
  onTagChange: (value: string) => void
  vendors: PricingVendor[]
  groups: string[]
  groupRatios?: Record<string, number>
  /** Canonical tag slugs, from `extractAllTags`. Resolved to labels here. */
  tags: string[]
  models: PricingModel[]
  hasActiveFilters: boolean
  onClearFilters: () => void
  className?: string
}

function countBy(
  models: PricingModel[],
  predicate: (model: PricingModel) => boolean
): number {
  return models.reduce((count, model) => count + (predicate(model) ? 1 : 0), 0)
}

function FilterChip(props: {
  option: FilterOption
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={props.onClick}
      // The chips in a section are a single-select set, and selection was
      // conveyed by fill alone. Mirrors the toolbar's segmented control.
      aria-pressed={props.active}
      className={cn(
        // gap-1.5, not gap-2: two chips per row is the density the rail is sized
        // for, and at 16px icons plus a count badge the extra 2px per gap is
        // enough to push a name like "DeepSeek" onto a row of its own.
        'group inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 font-medium transition-all',
        // Same focus treatment as `Button`: these are bare buttons, so without
        // it they fall back to the UA ring and look foreign next to Reset.
        'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        PRICING_FILTER_SCALE.chipLabel,
        // Selection reads as brand blue, not a darker grey. `accent` +
        // `accent-foreground` is a paired token (primary-tinted surface,
        // guaranteed-contrast text) in both themes, so this stays AA at 13px —
        // `text-primary` on white would not, `--primary` sits at L=0.692. The
        // blue border carries the signal so selection survives greyscale and
        // does not lean on hue alone.
        props.active
          ? 'border-primary/45 bg-accent text-accent-foreground font-semibold shadow-sm'
          : 'border-border/70 bg-canvas text-muted-foreground hover:border-primary/30 hover:bg-accent/50 hover:text-foreground'
      )}
      title={props.option.label}
    >
      {props.option.icon && (
        <span className='shrink-0'>{props.option.icon}</span>
      )}
      <span className='truncate'>{props.option.label}</span>
      {(props.option.suffix || props.option.count != null) && (
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5',
            PRICING_FILTER_SCALE.chipBadge,
            // Solid primary on a selected chip: the count is the one element
            // that can take a saturated fill without competing with the label,
            // and it gives selection a second, non-hue cue. Unselected stays
            // translucent — `bg-muted` is too close to the canvas well to read.
            props.active
              ? 'bg-primary text-primary-foreground'
              : 'bg-foreground/8 text-muted-foreground'
          )}
        >
          {props.option.suffix ?? props.option.count}
        </span>
      )}
    </button>
  )
}

function FilterSection(props: FilterSectionProps) {
  return (
    <Collapsible
      defaultOpen
      className='border-border/70 border-b pb-4 last:border-b-0 last:pb-0'
    >
      <CollapsibleTrigger className='group flex w-full items-center justify-between py-3 text-left'>
        <span
          className={cn(
            'text-foreground font-semibold',
            PRICING_FILTER_SCALE.sectionTitle
          )}
        >
          {props.title}
        </span>
        <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Each section is one single-select set, so it gets a name of its own.
            Without it a screen reader hears a flat run of toggle buttons with
            no clue which facet any of them belongs to. */}
        <div
          role='group'
          aria-label={props.title}
          className='flex flex-wrap gap-2'
        >
          {props.options.map((option) => (
            <FilterChip
              key={option.value}
              option={option}
              active={props.value === option.value}
              onClick={() => props.onChange(option.value)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function PricingSidebar(props: PricingSidebarProps) {
  const { t } = useTranslation()
  const tagRegistry = useTagRegistry()
  const quotaTypeLabels = getQuotaTypeLabels(t)
  const endpointTypeLabels = getEndpointTypeLabels(t)

  const vendorOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Vendors'),
      count: props.models.length,
    },
    ...props.vendors
      .map((vendor) => ({
        value: vendor.name,
        label: vendor.name,
        count: countBy(
          props.models,
          (model) => model.vendor_name === vendor.name
        ),
        icon: vendor.icon
          ? getLobeIcon(vendor.icon, PRICING_FILTER_SCALE.chipIconSize)
          : undefined,
      }))
      .filter((vendor) => vendor.count > 0),
  ]

  const groupOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Groups'),
    },
    ...props.groups.map((group) => ({
      value: group,
      label: group,
      suffix:
        props.groupRatios?.[group] == null
          ? undefined
          : formatGroupRatio(props.groupRatios[group], t),
    })),
  ]

  const quotaOptions: FilterOption[] = [
    {
      value: QUOTA_TYPES.ALL,
      label: quotaTypeLabels[QUOTA_TYPES.ALL],
      count: props.models.length,
    },
    {
      value: QUOTA_TYPES.TOKEN,
      label: quotaTypeLabels[QUOTA_TYPES.TOKEN],
      count: countBy(props.models, (model) => model.quota_type === 0),
    },
    {
      value: QUOTA_TYPES.REQUEST,
      label: quotaTypeLabels[QUOTA_TYPES.REQUEST],
      count: countBy(props.models, (model) => model.quota_type === 1),
    },
  ]

  // Counted in one pass keyed by slug, rather than re-scanning the catalog per
  // chip: the chips and the tag filter now agree on slug as the tag's identity,
  // so a model tagged `Hot` counts towards the `hot` chip.
  const tagCounts = new Map<string, number>()
  for (const model of props.models) {
    for (const tag of resolveTagList(model.tags, tagRegistry)) {
      tagCounts.set(tag.slug, (tagCounts.get(tag.slug) ?? 0) + 1)
    }
  }

  const tagOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Tags'),
      count: props.models.length,
    },
    // Slug in, label out: the value is what the filter state carries and what
    // `filterByTag` matches against, while the label follows the interface
    // language, so a `hot` tag reads as "热门" on a Chinese install instead of
    // showing whichever spelling the operator happened to type first.
    ...props.tags
      .map((slug) => resolveTag(slug, tagRegistry))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((tag) => ({
        value: tag.slug,
        label: tag.label,
        count: tagCounts.get(tag.slug) ?? 0,
      })),
  ]

  const endpointOptions: FilterOption[] = [
    {
      value: ENDPOINT_TYPES.ALL,
      label: endpointTypeLabels[ENDPOINT_TYPES.ALL],
      count: props.models.length,
    },
    ...Object.entries(endpointTypeLabels)
      .filter(([value]) => value !== ENDPOINT_TYPES.ALL)
      .map(([value, label]) => ({
        value,
        label,
        count: countBy(
          props.models,
          (model) => model.supported_endpoint_types?.includes(value) ?? false
        ),
      })),
  ]

  // `bg-card`: the panel had a card's shape (border + radius) but no surface,
  // so on the tinted canvas it would read as an outline drawn on the page
  // rather than a panel sitting on it.
  return (
    <aside className={cn('bg-card rounded-xl border p-4', props.className)}>
      {/* Title and Reset on one row, the description on its own line below: the
          description is a full sentence and sharing a row with the button left
          it two or three words wide. */}
      <div className='flex items-center justify-between gap-2'>
        <h2
          className={cn(
            'text-foreground font-bold',
            PRICING_FILTER_SCALE.panelTitle
          )}
        >
          {t('Filter')}
        </h2>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={props.onClearFilters}
          disabled={!props.hasActiveFilters}
          className='-mr-1 h-7 shrink-0 gap-1.5 px-2 text-xs'
        >
          <RotateCcw className='size-3.5' />
          {t('Reset')}
        </Button>
      </div>
      <p className='text-muted-foreground mt-1 text-xs leading-relaxed'>
        {t('Refine models by provider, group, type, and tags.')}
      </p>

      {props.hasActiveFilters && (
        <Badge variant='secondary' className='mt-3'>
          {t('Filters active')}
        </Badge>
      )}

      <div className='mt-1'>
        <FilterSection
          title={t('Groups')}
          value={props.groupFilter}
          options={groupOptions}
          onChange={props.onGroupChange}
        />
        <FilterSection
          title={t('All Vendors')}
          value={props.vendorFilter}
          options={vendorOptions}
          onChange={props.onVendorChange}
        />
        <FilterSection
          title={t('Model Tags')}
          value={props.tagFilter}
          options={tagOptions}
          onChange={props.onTagChange}
        />
        <FilterSection
          title={t('Pricing Type')}
          value={props.quotaTypeFilter}
          options={quotaOptions}
          onChange={props.onQuotaTypeChange}
        />
        <FilterSection
          title={t('Endpoint Type')}
          value={props.endpointTypeFilter}
          options={endpointOptions}
          onChange={props.onEndpointTypeChange}
        />
      </div>
    </aside>
  )
}
