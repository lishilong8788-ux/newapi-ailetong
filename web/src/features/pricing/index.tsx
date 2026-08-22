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
import { BadgePercent, Boxes, Layers, Sparkles } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { cn } from '@/lib/utils'

import {
  LoadingSkeleton,
  EmptyState,
  PricingTable,
  PricingSidebar,
  PricingToolbar,
  ModelCardGrid,
  ModelDetailsDrawer,
} from './components'
import {
  EXCLUDED_GROUPS,
  PRICING_SHELL_COLUMNS_CLASS,
  VIEW_MODES,
} from './constants'
import { useFilters } from './hooks/use-filters'
import { usePricingData } from './hooks/use-pricing-data'

// Hero band palette, sampled to sit in the same family as the landing hero.
// Deliberately theme-independent: the band is brand chrome that stays navy in
// light and dark alike, which is what makes home -> pricing feel continuous.
const HERO_NAVY_TOP = 'oklch(0.26 0.055 258)'
const HERO_NAVY_MID = 'oklch(0.23 0.05 256)'
const HERO_NAVY_BOTTOM = 'oklch(0.21 0.045 255)'

// Star field: hand-placed 1px dots. A repeating pattern reads as a texture and
// a canvas/SVG layer is overkill for decoration, so the positions are literal.
const HERO_STARS = [
  ['12%', '22%', 'rgba(255,255,255,0.55)'],
  ['24%', '58%', 'rgba(255,255,255,0.30)'],
  ['31%', '14%', 'rgba(255,255,255,0.40)'],
  ['46%', '72%', 'rgba(255,255,255,0.25)'],
  ['57%', '30%', 'rgba(255,255,255,0.35)'],
  ['68%', '64%', 'rgba(255,255,255,0.45)'],
  ['74%', '18%', 'rgba(255,255,255,0.28)'],
  ['86%', '44%', 'rgba(255,255,255,0.50)'],
  ['92%', '76%', 'rgba(255,255,255,0.22)'],
  ['5%', '68%', 'rgba(255,255,255,0.32)'],
]
  .map(
    ([x, y, color]) =>
      `radial-gradient(1px 1px at ${x} ${y}, ${color} 0%, transparent 100%)`
  )
  .join(', ')

export function Pricing() {
  const { t } = useTranslation()
  const [selectedModelName, setSelectedModelName] = useState<string | null>(
    null
  )

  const {
    models,
    vendors,
    groupRatio,
    usableGroup,
    endpointMap,
    autoGroups,
    isLoading,
    priceRate,
    usdExchangeRate,
  } = usePricingData()

  const {
    searchInput,
    sortBy,
    vendorFilter,
    groupFilter,
    quotaTypeFilter,
    endpointTypeFilter,
    tagFilter,
    tokenUnit,
    viewMode,
    showRechargePrice,
    setSearchInput,
    setSortBy,
    setVendorFilter,
    setGroupFilter,
    setQuotaTypeFilter,
    setEndpointTypeFilter,
    setTagFilter,
    setTokenUnit,
    setViewMode,
    setShowRechargePrice,
    filteredModels,
    hasActiveFilters,
    activeFilterCount,
    availableTags,
    clearFilters,
    clearSearch,
  } = useFilters(models || [])

  const handleModelClick = useCallback((modelName: string) => {
    setSelectedModelName(modelName)
  }, [])

  const selectedModel = useMemo(
    () =>
      selectedModelName
        ? (models || []).find(
            (model) => model.model_name === selectedModelName
          ) || null
        : null,
    [models, selectedModelName]
  )

  const availableGroups = useMemo(
    () =>
      Object.keys(usableGroup || {}).filter(
        (g) => !EXCLUDED_GROUPS.includes(g)
      ),
    [usableGroup]
  )

  // Counted from the models actually on the page, not from the raw vendor list:
  // a vendor with every model disabled would otherwise inflate the hero.
  const heroStats = useMemo(() => {
    const vendorNames = new Set(
      (models || []).map((model) => model.vendor_name).filter(Boolean)
    )
    return [
      // Tones are fixed light values, not theme tokens: these chips always sit on
      // the navy band, so a theme-derived colour would go unreadable in one mode.
      {
        icon: Sparkles,
        value: models?.length || 0,
        label: t('Models'),
        tone: 'text-sky-300',
      },
      {
        icon: Boxes,
        value: vendorNames.size,
        label: t('Providers'),
        tone: 'text-violet-300',
      },
      {
        icon: Layers,
        value: availableGroups.length,
        label: t('Groups'),
        tone: 'text-indigo-300',
      },
    ]
  }, [availableGroups.length, models, t])

  const handleClearAll = useCallback(() => {
    clearFilters()
    clearSearch()
  }, [clearFilters, clearSearch])

  const renderPricingContent = () => {
    if (filteredModels.length === 0) {
      return (
        <EmptyState
          searchQuery={searchInput}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={handleClearAll}
        />
      )
    }

    if (viewMode === VIEW_MODES.CARD) {
      return (
        <ModelCardGrid
          models={filteredModels}
          onModelClick={handleModelClick}
          priceRate={priceRate}
          usdExchangeRate={usdExchangeRate}
          tokenUnit={tokenUnit}
          showRechargePrice={showRechargePrice}
          selectedGroup={groupFilter}
        />
      )
    }

    return (
      <PricingTable
        models={filteredModels}
        priceRate={priceRate}
        usdExchangeRate={usdExchangeRate}
        tokenUnit={tokenUnit}
        showRechargePrice={showRechargePrice}
        selectedGroup={groupFilter}
        usableGroup={usableGroup || {}}
        onModelClick={handleModelClick}
      />
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        {/* No max-width cap: the filter rail plus the card grid are both fluid,
            so capping the shell only parked empty canvas either side of the rail
            on wide displays. Horizontal padding is what keeps content off the
            viewport edge. */}
        <PageTransition className='relative w-full pb-8 sm:pb-10'>
          {/* The navy band is a child of the hero section rather than a fixed-height
              overlay, so it tracks however tall the heading wraps at any viewport.
              It bleeds full-width (inset-x from the padded container) and fades to
              transparent across its bottom third, letting the light content below
              meet it without a seam. */}
          <section className='relative px-3 pt-24 pb-9 sm:px-6 sm:pt-26 sm:pb-10 xl:px-8'>
            {/* w-screen + centring escapes the section's horizontal padding so the
                navy reaches the viewport edges. The layout root clips overflow-x,
                so this cannot introduce a horizontal scrollbar. Ends on a hard edge,
                not a fade: a mask tail turns into a wide grey smear against the
                light canvas below. */}
            <div
              aria-hidden
              className='pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 border-b border-white/8'
              style={{
                background: `linear-gradient(to bottom, ${HERO_NAVY_TOP} 0%, ${HERO_NAVY_MID} 58%, ${HERO_NAVY_BOTTOM} 100%)`,
              }}
            >
              {/* Grid + centred glow + sparse stars: the same three texture layers
                  the landing hero uses, so this is not a flat slab of colour. */}
              <div className='absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.055)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_35%,black_25%,transparent_100%)] bg-[size:4rem_4rem]' />
              <div
                className='absolute inset-0'
                style={{
                  background: [
                    'radial-gradient(ellipse 55% 50% at 50% 10%, oklch(0.62 0.14 250 / 32%) 0%, transparent 72%)',
                    'radial-gradient(ellipse 42% 38% at 82% 24%, oklch(0.60 0.12 215 / 20%) 0%, transparent 72%)',
                    'radial-gradient(ellipse 38% 34% at 16% 30%, oklch(0.58 0.13 275 / 18%) 0%, transparent 72%)',
                  ].join(', '),
                }}
              />
              <div
                className='absolute inset-0'
                style={{
                  background: HERO_STARS,
                  backgroundRepeat: 'no-repeat',
                }}
              />
            </div>

            <header className='relative mx-auto max-w-3xl text-center'>
              {/* Deliberately not a computed discount: the deepest group ratio
                  moves with configuration, and quoting a number here promises a
                  rate the visitor's own group may not get. The per-model cards
                  below already show the exact figure. */}
              <div
                className='landing-animate-fade-up mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-400/12 px-3 py-1.5 text-[11px] font-medium text-amber-100 shadow-xs backdrop-blur-sm'
                style={{ animationDelay: '0ms' }}
              >
                <BadgePercent className='size-3.5 shrink-0 text-amber-300' />
                <span>{t('Team and enterprise plans get better rates')}</span>
              </div>

              <h1
                className='landing-animate-fade-up text-[clamp(2rem,5.5vw,3.5rem)] leading-[1.15] font-bold tracking-tight text-white'
                style={{ animationDelay: '60ms' }}
              >
                <span className='bg-gradient-to-r from-white via-sky-100 to-sky-300 bg-clip-text text-transparent'>
                  {t('Model Square')}
                </span>
              </h1>
              <p
                className='landing-animate-fade-up mx-auto mt-3 max-w-2xl text-xs leading-relaxed text-slate-300/80 opacity-0 sm:mt-4 sm:text-sm'
                style={{ animationDelay: '120ms' }}
              >
                {t(
                  'Discover curated AI models, compare pricing and capabilities, and choose the right model for every scenario.'
                )}
              </p>

              <div
                className='landing-animate-fade-up mt-5 flex flex-wrap items-center justify-center gap-2 opacity-0 sm:gap-2.5'
                style={{ animationDelay: '180ms' }}
              >
                {/* Liveness rides in the same pill rail as the counts: it
                    qualifies those numbers, so separating it onto its own line
                    above the title spent a whole row on one word.
                    leading-5 is load-bearing: the stat pills get their 20px line
                    box from their text-sm number, and this pill has no text-sm
                    child, so without it the pill renders 4px shorter. */}
                <div className='flex items-center gap-1.5 rounded-full border border-sky-300/25 bg-sky-400/10 px-3.5 py-1.5 backdrop-blur-sm'>
                  <span className='relative flex size-1.5'>
                    <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-300 opacity-75' />
                    <span className='relative inline-flex size-1.5 rounded-full bg-sky-300' />
                  </span>
                  <span className='text-xs leading-5 font-medium text-sky-200'>
                    {t('Real-time Pricing')}
                  </span>
                </div>

                {heroStats.map((stat) => (
                  <div
                    key={stat.label}
                    className='flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-3.5 py-1.5 backdrop-blur-sm'
                  >
                    <stat.icon className={cn('size-3.5 shrink-0', stat.tone)} />
                    <span className='text-sm font-semibold text-white tabular-nums'>
                      {isLoading ? '—' : stat.value}
                    </span>
                    <span className='text-xs text-slate-300/70'>
                      {stat.label}
                    </span>
                  </div>
                ))}
              </div>
            </header>
          </section>

          {isLoading ? (
            <div className='px-3 pt-5 sm:px-6 xl:px-8'>
              <LoadingSkeleton viewMode={viewMode} />
            </div>
          ) : (
            <div
              className={cn(
                'grid gap-4 px-3 pt-5 sm:px-6 xl:gap-5 xl:px-8',
                PRICING_SHELL_COLUMNS_CLASS
              )}
            >
              <PricingSidebar
                quotaTypeFilter={quotaTypeFilter}
                endpointTypeFilter={endpointTypeFilter}
                vendorFilter={vendorFilter}
                groupFilter={groupFilter}
                tagFilter={tagFilter}
                onQuotaTypeChange={setQuotaTypeFilter}
                onEndpointTypeChange={setEndpointTypeFilter}
                onVendorChange={setVendorFilter}
                onGroupChange={setGroupFilter}
                onTagChange={setTagFilter}
                vendors={vendors || []}
                groups={availableGroups}
                groupRatios={groupRatio}
                tags={availableTags}
                models={models || []}
                hasActiveFilters={hasActiveFilters}
                onClearFilters={clearFilters}
                className='hover-scrollbar sticky top-4 hidden max-h-[calc(100dvh-2rem)] self-start overflow-y-auto xl:block'
              />

              <main className='min-w-0 space-y-4'>
                <PricingToolbar
                  filteredCount={filteredModels.length}
                  totalCount={models?.length}
                  searchValue={searchInput}
                  onSearchChange={setSearchInput}
                  onSearchClear={clearSearch}
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                  tokenUnit={tokenUnit}
                  onTokenUnitChange={setTokenUnit}
                  showRechargePrice={showRechargePrice}
                  onRechargePriceChange={setShowRechargePrice}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  quotaTypeFilter={quotaTypeFilter}
                  endpointTypeFilter={endpointTypeFilter}
                  vendorFilter={vendorFilter}
                  groupFilter={groupFilter}
                  tagFilter={tagFilter}
                  onQuotaTypeChange={setQuotaTypeFilter}
                  onEndpointTypeChange={setEndpointTypeFilter}
                  onVendorChange={setVendorFilter}
                  onGroupChange={setGroupFilter}
                  onTagChange={setTagFilter}
                  vendors={vendors || []}
                  groups={availableGroups}
                  groupRatios={groupRatio}
                  tags={availableTags}
                  models={models || []}
                  hasActiveFilters={hasActiveFilters}
                  activeFilterCount={activeFilterCount}
                  onClearFilters={clearFilters}
                />

                {renderPricingContent()}
              </main>
            </div>
          )}

          {selectedModel && (
            <ModelDetailsDrawer
              open={Boolean(selectedModel)}
              onOpenChange={(open) => {
                if (!open) setSelectedModelName(null)
              }}
              model={selectedModel}
              groupRatio={groupRatio || {}}
              usableGroup={usableGroup || {}}
              endpointMap={
                (endpointMap as Record<
                  string,
                  { path?: string; method?: string }
                >) || {}
              }
              autoGroups={autoGroups || []}
              priceRate={priceRate ?? 1}
              usdExchangeRate={usdExchangeRate ?? 1}
              tokenUnit={tokenUnit}
              showRechargePrice={showRechargePrice}
            />
          )}
        </PageTransition>
      </div>
    </PublicLayout>
  )
}
