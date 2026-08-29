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
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { isAdminRole } from '../../lib/message/message-error-utils'
import {
  INITIAL_FILTER_STATE,
  MODALITY_TABS,
  type ModalityFilter,
  buildVendorOptions,
  countByModality,
  filterModels,
} from '../../lib/model-library/filters'
import type { GroupOption, ModelOption } from '../../types'
import { GroupRow } from './group-row'
import { ModelCard } from './model-card'
import { VendorFilter } from './vendor-filter'

type ModelLibraryProps = {
  models: ModelOption[]
  selectedModel: string
  isLoading: boolean
  onSelectModel: (modelName: string) => void
  /** Billing groups the user may use. Empty or single-entry hides the row. */
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
}

/**
 * How many cards are rendered before the reveal sentinel extends the list.
 *
 * A deployment can expose several hundred models, and mounting all of them costs
 * a vendor logo (a fresh SVG tree from `getLobeIcon`) and one or two badges per
 * card. Rendering the lot up front made the first paint of this column expensive
 * and left the DOM heavy enough to make scrolling it jerky.
 *
 * Chosen to overfill the tallest realistic column so nothing appears to be
 * missing before the sentinel takes over. The pricing grid solves the same
 * problem with explicit pagination (`DEFAULT_PRICING_PAGE_SIZE`); a sidebar
 * wants continuous scrolling, so it grows on scroll instead of on click.
 */
const MODEL_REVEAL_PAGE_SIZE = 30

/**
 * The playground's primary entry point: people arrive knowing the capability
 * they want ("write code", "make a picture"), so the model comes first and
 * everything downstream is derived from it.
 */
export function ModelLibrary({
  models,
  selectedModel,
  isLoading,
  onSelectModel,
  groups,
  groupValue,
  onGroupChange,
}: ModelLibraryProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.auth.user)
  const isAdmin = isAdminRole(user?.role)
  const [filters, setFilters] = useState(INITIAL_FILTER_STATE)

  const visibleModels = useMemo(
    () => filterModels(models, filters),
    [models, filters]
  )
  const modalityCounts = useMemo(
    () => countByModality(models, filters),
    [models, filters]
  )
  const vendorOptions = useMemo(
    () => buildVendorOptions(models, filters),
    [models, filters]
  )

  const [visibleCount, setVisibleCount] = useState(MODEL_REVEAL_PAGE_SIZE)
  const revealSentinelRef = useRef<HTMLDivElement | null>(null)
  const hasMoreToReveal = visibleCount < visibleModels.length

  // A new filter result is a new list; keeping the old count would leave a
  // narrowed search still paying for cards the user can no longer see.
  useEffect(() => {
    setVisibleCount(MODEL_REVEAL_PAGE_SIZE)
  }, [filters])

  useEffect(() => {
    const sentinel = revealSentinelRef.current
    if (!sentinel || !hasMoreToReveal) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return

        setVisibleCount((current) =>
          Math.min(current + MODEL_REVEAL_PAGE_SIZE, visibleModels.length)
        )
      },
      // Fires while the sentinel is still below the fold, so the next batch is
      // mounted before the user scrolls into empty space.
      { rootMargin: '300px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMoreToReveal, visibleModels.length])

  const renderedModels = useMemo(
    () => visibleModels.slice(0, visibleCount),
    [visibleModels, visibleCount]
  )

  return (
    <div className='bg-canvas flex h-full min-h-0 w-full flex-col'>
      {/* Two stacked blocks, not one flat `space-y`: the group row declares
          which models exist at all, the tabs and filters narrow down within
          that set. The rule between them is the only place in this column where
          a horizontal line is doing semantic work rather than decoration, so it
          gets its own spacing instead of a uniform gap. */}
      <div className='border-border/60 border-b p-4'>
        {/* A real title, not just a tab strip. The count tracks the active tab,
            so the "how many" that used to sit inside the selected pill now lives
            in a stable spot — which is also what freed the tabs to stop
            wrapping their labels onto two lines in a 288px column. */}
        <div className='flex items-baseline justify-between gap-2'>
          <h2 className='text-foreground text-[15px] font-bold tracking-tight'>
            {t('Model library')}
          </h2>
          {modalityCounts[filters.modality] > 0 ? (
            <span className='text-muted-foreground/70 text-[12px] font-medium tabular-nums'>
              {modalityCounts[filters.modality]}
            </span>
          ) : null}
        </div>

        {/* Renders nothing when the user has at most one usable group, in which
            case the rule below it would be separating a heading from filters —
            so the divider is conditional on the same test. */}
        {groups.length > 1 ? (
          <>
            <div className='mt-3'>
              <GroupRow
                groups={groups}
                value={groupValue}
                onChange={onGroupChange}
                disabled={isLoading}
              />
            </div>
            <div className='bg-border/70 mt-4 h-px' aria-hidden='true' />
          </>
        ) : null}

        <div className='bg-muted/50 mt-3 flex items-center gap-0.5 rounded-full p-0.5'>
          {MODALITY_TABS.map((tab) => (
            <ModalityTab
              key={tab.value}
              label={t(tab.labelKey)}
              isActive={filters.modality === tab.value}
              onClick={() =>
                setFilters((prev) => ({ ...prev, modality: tab.value }))
              }
            />
          ))}
        </div>

        <div className='mt-3 flex items-center gap-2'>
          <VendorFilter
            options={vendorOptions}
            value={filters.vendor}
            onChange={(vendor) => setFilters((prev) => ({ ...prev, vendor }))}
          />
          <div className='relative flex-1'>
            <Search className='text-muted-foreground/60 pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, search: event.target.value }))
              }
              placeholder={t('Search models')}
              className='h-8 pl-8 text-[13px]'
            />
          </div>
        </div>
      </div>

      {/* A native scroll container with `hover-scrollbar`, matching the pricing
          sidebar. `ScrollArea` renders a permanent 10px bar and does not expose
          its scrollbar through props, so slimming it would mean editing a
          component shared by dozens of dialogs. */}
      <div className='hover-scrollbar min-h-0 flex-1 overflow-y-auto'>
        <div className='space-y-2 p-2.5'>
          <ModelList
            models={renderedModels}
            isAdmin={isAdmin}
            totalCount={models.length}
            selectedModel={selectedModel}
            activeModality={filters.modality}
            isLoading={isLoading}
            onSelectModel={onSelectModel}
          />

          {/* Rendered only while something remains, so the observer has nothing
              to watch once the list is fully revealed. */}
          {hasMoreToReveal ? (
            <div ref={revealSentinelRef} className='h-8' aria-hidden='true' />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * A segmented control, not a row of bordered chips.
 *
 * These tabs switch one view between five states, so they read best as one
 * connected strip: an inactive tab is bare text and only the active one takes a
 * filled pill. Giving each its own border turned five buttons into five boxes
 * competing for attention.
 *
 * Each tab claims an equal `flex-1` slice and keeps its label on one line
 * (`whitespace-nowrap`): five two-character CJK labels do not fit a 288px column
 * side by side otherwise, and the browser was breaking them mid-word into "聊 /
 * 天". The per-tab count moved to the header for the same reason.
 *
 * `bg-primary` + `primary-foreground` is safe here (unlike `text-primary` on a
 * plain surface) because the pair is designed to be used together.
 */
function ModalityTab(props: {
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={props.onClick}
      aria-pressed={props.isActive}
      className={cn(
        'inline-flex h-8 flex-1 items-center justify-center rounded-full px-1 text-[13px] whitespace-nowrap transition-colors',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        props.isActive
          ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
      )}
    >
      {props.label}
    </button>
  )
}

type ModelListProps = {
  models: ModelOption[]
  /** Distinguishes "nothing available" from "nothing matched the filters". */
  totalCount: number
  /** Only admins get the "unpriced models are hidden" hint; see `ModelList`. */
  isAdmin: boolean
  selectedModel: string
  activeModality: ModalityFilter
  isLoading: boolean
  onSelectModel: (modelName: string) => void
}

function ModelList({
  isAdmin,
  models,
  totalCount,
  selectedModel,
  activeModality,
  isLoading,
  onSelectModel,
}: ModelListProps) {
  const { t } = useTranslation()

  if (isLoading) {
    return Array.from({ length: 6 }, (_, index) => (
      <Skeleton key={index} className='h-16 w-full rounded-lg' />
    ))
  }

  if (models.length === 0) {
    return (
      <div className='px-2 py-8 text-center'>
        <p className='text-muted-foreground text-xs'>
          {totalCount === 0
            ? t('No models available')
            : t('No models match the filters')}
        </p>
        {/* An empty library is ambiguous to whoever can fix it.
            Unpriced models are filtered out of the playground, so a site with
            nothing priced yet shows "No models available" to an admin who knows
            perfectly well the models exist — the list is empty *because* of a
            setting they own. Non-admins get nothing extra: they cannot act on it
            and "ask an administrator" adds no information to an empty list. */}
        {totalCount === 0 && isAdmin ? (
          <p className='text-muted-foreground/70 mx-auto mt-2 max-w-[16rem] text-[11px] leading-relaxed'>
            {t('Models without a configured price are not shown here.')}
          </p>
        ) : null}
      </div>
    )
  }

  return models.map((model) => (
    <ModelCard
      key={model.value}
      model={model}
      isSelected={model.value === selectedModel}
      activeModality={activeModality}
      onSelect={onSelectModel}
    />
  ))
}
