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
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Info, Route } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { sideDrawerContentClassName } from '@/components/drawer-layout'
import { GroupBadge } from '@/components/group-badge'
import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { DEFAULT_TOKEN_UNIT } from '../constants'
import { useChannelPricing } from '../hooks/use-channel-pricing'
import { usePricingData } from '../hooks/use-pricing-data'
import type { PricingModel, TokenUnit } from '../types'
import { AutoRouteCard } from './auto-route-card'
import { AutoRouteSettings } from './auto-route-settings'
import { ChannelPriceCards } from './channel-price-cards'
import { CachePricingNotice, ChannelRouteDetail } from './channel-route-detail'
import { DynamicPricingBreakdown } from './dynamic-pricing-breakdown'
import { GroupPriceCards } from './group-price-cards'
import { ModelApiQuickref } from './model-api-quickref'
import { ModelCodeSamplesDrawer } from './model-code-samples-drawer'
import { ModelDetailsCatalog } from './model-details-catalog'
import { ModelDetailsHeader } from './model-details-header'
import { ModelDetailsPerformance } from './model-details-performance'
import { DetailsCard, SectionTitle } from './model-details-shared'

const MODEL_DETAILS_SKELETON_KEYS = ['first', 'second', 'third', 'fourth']

// ----------------------------------------------------------------------------
// Auto group chain (used inside group pricing section)
// ----------------------------------------------------------------------------

function AutoGroupChain(props: { model: PricingModel; autoGroups: string[] }) {
  const { t } = useTranslation()
  const modelEnableGroups = Array.isArray(props.model.enable_groups)
    ? props.model.enable_groups
    : []
  const autoChain = props.autoGroups.filter((g) =>
    modelEnableGroups.includes(g)
  )

  if (autoChain.length === 0) return null

  return (
    <div className='text-muted-foreground mb-3 flex flex-wrap items-center gap-1 text-xs'>
      <span className='font-medium'>{t('Auto Group Chain')}</span>
      <span className='text-muted-foreground/40'>→</span>
      {autoChain.map((g, idx) => (
        <span key={g} className='flex items-center gap-1'>
          <GroupBadge group={g} size='sm' />
          {idx < autoChain.length - 1 && (
            <span className='text-muted-foreground/40'>→</span>
          )}
        </span>
      ))}
    </div>
  )
}

// Two tabs, not three. The API reference used to be the third one, and a tab is
// the wrong container for it: it is read *against* the prices rather than instead
// of them, and switching tabs cost the reader the channel they had selected. It
// opens as a second drawer over this one now (`ModelCodeSamplesDrawer`), reached
// from the "View code samples" button on the API panel in either pane.
const TAB_VALUES = ['channels', 'info'] as const
type TabValue = (typeof TAB_VALUES)[number]

const TAB_META: Record<
  TabValue,
  { icon: React.ComponentType<{ className?: string }>; labelKey: string }
> = {
  channels: { icon: Route, labelKey: 'Model Pricing & Usage' },
  info: { icon: Info, labelKey: 'Basic Info' },
}

export interface ModelDetailsContentProps {
  model: PricingModel
  groupRatio: Record<string, number>
  usableGroup: Record<string, string>
  endpointMap: Record<string, { path?: string; method?: string }>
  autoGroups: string[]
  priceRate: number
  usdExchangeRate: number
  tokenUnit: TokenUnit
  showRechargePrice?: boolean
  /**
   * Drawer mode. The identity bar and the tab switcher are pinned to the panel's
   * top edge and each column below scrolls on its own, so picking a channel on
   * the left never scrolls its prices out of reach on the right.
   *
   * The standalone route stays a normal document: one page scroll, header
   * included. It is a 5xl centred column under a Back button, not a panel with a
   * fixed height to divide up.
   */
  docked?: boolean
}

export function ModelDetailsContent(props: ModelDetailsContentProps) {
  const { t } = useTranslation()
  const showRechargePrice = props.showRechargePrice ?? false
  const [tab, setTab] = useState<TabValue>('channels')
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(
    null
  )
  const [codeSamplesOpen, setCodeSamplesOpen] = useState(false)

  const isDynamic =
    props.model.billing_mode === 'tiered_expr' &&
    Boolean(props.model.billing_expr)

  // Per-channel tiers load separately from the catalog and are allowed to come
  // back empty: a model whose channels have no configured sell discount, or an
  // install where the endpoint is unreachable, still renders every section
  // below. Nothing here blocks on `isLoading` for that reason.
  const { routes, autoRoute } = useChannelPricing(props.model.model_name)
  const user = useAuthStore((state) => state.auth.user)
  const canManageRouting = Boolean(user?.role && user.role >= ROLE.ADMIN)

  const selectedRoute = useMemo(() => {
    if (selectedChannelId == null) return null
    return routes.find((r) => r.channel_id === selectedChannelId) ?? null
  }, [routes, selectedChannelId])

  const autoRouteBadgeText = autoRoute?.ranked
    ? t('Lowest price')
    : t('Automatic routing')
  const docked = props.docked ?? false

  return (
    <div
      className={cn(
        '@container/details',
        docked
          ? // The tray the cards sit in. In light mode `--background` and
            // `--card` are the same pure white, so a `bg-card` card on the
            // drawer's default `bg-background` had nothing behind it to lift off
            // and the panel read as flat whatever the cards did. `--canvas` is
            // not enough either — it resolves ~2.8% below card white and is
            // documented to stay un-nameable as a hue, which is the opposite of
            // what a card tray needs.
            //
            // Flat, not a gradient. A wash fading to transparent made the top of
            // the panel tinted and the bottom card-white, so the body matched
            // the white header bar at one end and not the other — the seam read
            // as two different backgrounds stacked.
            'bg-surface-sunken flex h-full min-h-0 flex-col'
          : 'space-y-5'
      )}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabValue)}
        className={cn('gap-4', docked && 'min-h-0 flex-1 gap-0')}
      >
        {/* The switcher rides in the identity bar rather than a strip of its own.
            Pinned in the drawer by being outside the scrolling area — no sticky
            positioning, so nothing can be painted over it. */}
        <ModelDetailsHeader
          model={props.model}
          tokenUnit={props.tokenUnit}
          priceRate={props.priceRate}
          usdExchangeRate={props.usdExchangeRate}
          showRechargePrice={showRechargePrice}
          docked={docked}
          trailing={
            // The switcher sits on the band, so it is inverted: a recessed track
            // with a solid white pill for the active tab, which is how the
            // reference marks selection on colour.
            //
            // The track darkens the band rather than lightening it. A white veil
            // is the instinct, but `bg-white/15` lifts the surface under the
            // labels to ~2.9:1 against white; `bg-black/10` drops it to ~5.6:1 and
            // still reads as recessed. Labels are therefore full white, not
            // white/75, which would have given back what the dark track bought.
            //
            // The `dark:` overrides are not redundant — the primitive's own dark
            // rules would paint a grey `input/30` pill and a muted label, both of
            // which disappear against a dark blue band.
            <TabsList className='w-full gap-1 rounded-lg bg-black/10 p-1 group-data-horizontal/tabs:h-9 sm:w-auto'>
              {TAB_VALUES.map((value) => {
                const Icon = TAB_META[value].icon
                return (
                  <TabsTrigger
                    key={value}
                    value={value}
                    // `hover:text-white` has to be repeated under `data-active`
                    // as the band colour. The project's `data-active` variant
                    // compiles to `:where([data-active]...)`, which is zero
                    // specificity on purpose, so a plain `hover:text-white`
                    // (0,2,0) outranks `data-active:text-band-start` (0,1,0) and
                    // painted the active label white on its white pill — the tab
                    // read as an empty capsule under the pointer. Restating it as
                    // `data-active:hover:*` puts the two at 0,2,0 and lets the
                    // later rule win, the same stacking `navigation-menu` uses.
                    //
                    // The inactive tab answers the pointer by deepening the
                    // track rather than veiling it in white, for the reason the
                    // track is `bg-black/10` to begin with: white lifts the
                    // surface under a white label toward ~2.9:1, black keeps it
                    // past 5.6:1.
                    className='data-active:text-band-start data-active:hover:text-band-start dark:data-active:text-band-start dark:data-active:hover:text-band-start min-w-0 flex-1 gap-1.5 rounded-md px-3 text-xs text-white not-data-active:hover:bg-black/10 hover:text-white data-active:bg-white sm:flex-initial sm:text-sm dark:text-white dark:hover:text-white dark:data-active:border-transparent dark:data-active:bg-white'
                  >
                    <Icon className='size-3.5' />
                    <span className='truncate'>
                      {t(TAB_META[value].labelKey)}
                    </span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          }
        />

        <TabsContent
          value='channels'
          className={cn('outline-none', docked && 'flex min-h-0 flex-col')}
        >
          {/* Two scrolling columns from lg, one scrolling page below it: side by
              side they each scroll on their own, stacked they would trap the
              reader in a 300px-tall box inside another. `items-stretch` is what
              gives the columns the row's full height to scroll within.
              `no-scrollbar` on every scroller in this panel — two visible rails
              inside one drawer read as seams in the layout, and wheel, touch and
              keyboard scrolling are unaffected by hiding the rail. */}
          {routes.length > 0 ? (
            <div
              className={cn(
                'flex flex-col lg:flex-row items-start',
                docked
                  ? 'no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 lg:items-stretch lg:overflow-hidden lg:p-0'
                  : 'gap-5'
              )}
            >
              {/* Left sidebar: nothing but the route selector. Prices that depend
                  on which route is selected belong on the right, next to the
                  selection they follow. In the drawer it scrolls as its own
                  column from lg — the channel list is long, and scrolling it must
                  not carry the selected channel's prices off the screen. */}
              <div
                className={cn(
                  'w-full lg:w-[330px] xl:w-[360px] shrink-0 space-y-2',
                  docked &&
                    'no-scrollbar lg:border-border/60 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:py-4 lg:pr-4 lg:pl-6'
                )}
              >
                <AutoRouteCard
                  routes={routes}
                  autoRoute={autoRoute}
                  selected={selectedChannelId === null}
                  onSelect={() => setSelectedChannelId(null)}
                />
                <ChannelPriceCards
                  model={props.model}
                  routes={routes}
                  priceRate={props.priceRate}
                  usdExchangeRate={props.usdExchangeRate}
                  tokenUnit={props.tokenUnit}
                  showRechargePrice={showRechargePrice}
                  selectedChannelId={selectedChannelId}
                  onSelectChannel={(id) => setSelectedChannelId(id)}
                  showNotice={false}
                />
              </div>

              {/* Right main area: Detail, settings and API documentation. In the
                  drawer it is the second scrolling column; on the standalone page
                  it sticks under the header instead, because there the page itself
                  is what scrolls. */}
              <div
                className={cn(
                  'no-scrollbar w-full flex-1 min-w-0 space-y-4',
                  docked
                    ? 'mt-5 lg:mt-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:py-4 lg:pr-6 lg:pl-4'
                    : 'lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain'
                )}
              >
                {selectedRoute ? (
                  <ChannelRouteDetail
                    model={props.model}
                    route={selectedRoute}
                    priceRate={props.priceRate}
                    usdExchangeRate={props.usdExchangeRate}
                    tokenUnit={props.tokenUnit}
                    showRechargePrice={showRechargePrice}
                    endpointMap={props.endpointMap}
                    usableGroup={props.usableGroup}
                    routeCount={routes.length}
                    onBackToAuto={() => setSelectedChannelId(null)}
                    onViewCodeSamples={() => setCodeSamplesOpen(true)}
                  />
                ) : (
                  <>
                    <CachePricingNotice />

                    {/* Auto-route's own group prices, off the catalog's platform
                        rate rather than any one channel's: with routing left on
                        automatic the serving channel is not decided yet, so the
                        standard price is the only honest quote. Selecting a
                        channel replaces this with that channel's own. */}
                    <DetailsCard className='p-4'>
                      <SectionTitle className='mb-1.5 text-[11px]'>
                        {t('Group Pricing')}
                      </SectionTitle>
                      <AutoGroupChain
                        model={props.model}
                        autoGroups={props.autoGroups}
                      />
                      <GroupPriceCards
                        model={props.model}
                        usableGroup={props.usableGroup}
                        priceRate={props.priceRate}
                        usdExchangeRate={props.usdExchangeRate}
                        tokenUnit={props.tokenUnit}
                        showRechargePrice={showRechargePrice}
                      />
                    </DetailsCard>

                    <AutoRouteSettings
                      model={props.model}
                      routes={routes}
                      autoRoute={autoRoute}
                      priceRate={props.priceRate}
                      usdExchangeRate={props.usdExchangeRate}
                      tokenUnit={props.tokenUnit}
                      showRechargePrice={showRechargePrice}
                      canManage={canManageRouting}
                      hideTitle
                    />
                    <ModelApiQuickref
                      model={props.model}
                      endpointMap={props.endpointMap}
                      title={t('API Documentation')}
                      badgeText={autoRouteBadgeText}
                      routeCount={routes.length}
                      onViewCodeSamples={() => setCodeSamplesOpen(true)}
                    />
                  </>
                )}
              </div>
            </div>
          ) : (
            <div
              className={cn(
                'space-y-6',
                docked &&
                  'no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6'
              )}
            >
              <section>
                <SectionTitle>{t('Your price')}</SectionTitle>
                <AutoGroupChain
                  model={props.model}
                  autoGroups={props.autoGroups}
                />
                <GroupPriceCards
                  model={props.model}
                  usableGroup={props.usableGroup}
                  priceRate={props.priceRate}
                  usdExchangeRate={props.usdExchangeRate}
                  tokenUnit={props.tokenUnit}
                  showRechargePrice={showRechargePrice}
                />
              </section>
              <ModelApiQuickref
                model={props.model}
                endpointMap={props.endpointMap}
                onViewCodeSamples={() => setCodeSamplesOpen(true)}
              />
            </div>
          )}
        </TabsContent>

        {/* No prices here by design: this tab is the model's own reference sheet.
            Group prices sit next to the selected route, because the route decides
            the rate they scale. The tier breakdown stays because it explains the
            billing expression rather than quoting a number. */}
        <TabsContent
          value='info'
          className={cn(
            'space-y-6 outline-none',
            docked &&
              'no-scrollbar min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6'
          )}
        >
          {/* Carded at the call site, not inside the component: the breakdown is
              also rendered *within* other cards (the channel route detail), where
              a second surface would nest a card in a card. */}
          {isDynamic && (
            <DetailsCard className='px-4'>
              <DynamicPricingBreakdown billingExpr={props.model.billing_expr} />
            </DetailsCard>
          )}

          {/* Live metrics lead, the catalog sheet follows. The catalog is a
              static reference sheet whose fields `/api/pricing` mostly does not
              serve yet, so opening the tab on it meant opening on a column of em
              dashes; TPS, latency and success rate are the numbers that actually
              move and the reason a reader opens this tab twice. */}
          <ModelDetailsPerformance
            model={props.model}
            usableGroup={props.usableGroup}
          />

          <ModelDetailsCatalog model={props.model} />
        </TabsContent>
      </Tabs>

      {/* Opens over whichever pane asked for it, carrying that pane's line: from
          a selected channel the samples arrive pinned to it, from automatic
          routing they arrive on the bare model name. */}
      <ModelCodeSamplesDrawer
        open={codeSamplesOpen}
        onOpenChange={setCodeSamplesOpen}
        model={props.model}
        endpointMap={props.endpointMap}
        routes={routes}
        lineCode={selectedRoute?.code}
      />
    </div>
  )
}

// ----------------------------------------------------------------------------
// Drawer & page wrappers
// ----------------------------------------------------------------------------

export interface ModelDetailsDrawerProps extends ModelDetailsContentProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModelDetailsDrawer(props: ModelDetailsDrawerProps) {
  const { t } = useTranslation()
  const { open, onOpenChange, ...contentProps } = props

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        // lg 起取屏幕宽度的一半（50vw，封顶 64rem 防超宽屏失控）；更小的屏
        // 仍按断点给足宽度，两栏布局在 lg 以下本来就叠成单列。
        className={sideDrawerContentClassName(
          cn(
            'sm:max-w-3xl md:max-w-4xl lg:max-w-[min(50vw,64rem)]',
            // No left border. `sheet.tsx` gives every right-side panel a
            // `border-l` and paints its background with `bg-clip-padding`, so the
            // border is a light hairline the panel's own fill never reaches under.
            // On the white header every other drawer opens with that is
            // invisible; against this one's saturated band it reads as a pale
            // strip down the left of the colour and the band stops looking
            // full-bleed. Nothing replaces it: side panels in this app are
            // deliberately shadowless (`sideDrawerContentClassName` sets
            // `shadow-none`), and the backdrop's dim-and-blur is what separates an
            // open drawer from the page.
            'border-l-0',
            // The close button is the shared one from `sheet.tsx` — a dark ghost
            // icon, which this panel now parks on a saturated blue band.
            // Recoloured from here rather than in `sheet.tsx`: every other drawer
            // in the app still opens on a white header and wants the dark icon.
            '[&>[data-slot=sheet-close]]:text-white/80 [&>[data-slot=sheet-close]]:hover:bg-white/15 [&>[data-slot=sheet-close]]:hover:text-white'
          )
        )}
      >
        <SheetHeader className='sr-only'>
          <SheetTitle>{props.model.model_name}</SheetTitle>
          <SheetDescription>{t('Model details')}</SheetDescription>
        </SheetHeader>
        {/* No scroll and no padding here: the bar is pinned by staying outside
            the scrolling area, and each panel below carries its own inset. */}
        <div className='flex min-h-0 flex-1 flex-col'>
          <ModelDetailsContent {...contentProps} docked />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function ModelDetails() {
  const { t } = useTranslation()
  const { modelId } = useParams({ from: '/pricing/$modelId/' })
  const search = useSearch({ from: '/pricing/$modelId/' })
  const navigate = useNavigate()

  const {
    models,
    groupRatio,
    usableGroup,
    endpointMap,
    autoGroups,
    isLoading,
    priceRate,
    usdExchangeRate,
  } = usePricingData()

  const tokenUnit: TokenUnit =
    search.tokenUnit === 'K' ? 'K' : DEFAULT_TOKEN_UNIT

  const model = useMemo(() => {
    if (!models || !modelId) return null
    return models.find((m) => m.model_name === modelId) || null
  }, [models, modelId])

  const handleBack = () => {
    navigate({ to: '/pricing', search })
  }

  if (isLoading) {
    return (
      <PublicLayout>
        <div className='mx-auto max-w-5xl px-4 sm:px-6'>
          <Skeleton className='mb-4 h-5 w-16' />
          <div className='space-y-2'>
            <Skeleton className='h-7 w-64' />
            <Skeleton className='h-4 w-40' />
            <Skeleton className='h-4 w-full max-w-md' />
          </div>
          <div className='mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4'>
            {MODEL_DETAILS_SKELETON_KEYS.map((key) => (
              <Skeleton key={`metric-${key}`} className='h-16 w-full' />
            ))}
          </div>
          <div className='mt-6 space-y-3'>
            {MODEL_DETAILS_SKELETON_KEYS.map((key) => (
              <Skeleton key={`section-${key}`} className='h-24 w-full' />
            ))}
          </div>
        </div>
      </PublicLayout>
    )
  }

  if (!model) {
    return (
      <PublicLayout>
        <div className='mx-auto max-w-2xl px-4 text-center sm:px-6'>
          <h2 className='mb-1 text-base font-semibold'>
            {t('Model not found')}
          </h2>
          <p className='text-muted-foreground mb-4 text-sm'>
            {t("The model you're looking for doesn't exist.")}
          </p>
          <Button onClick={handleBack} variant='outline' size='sm'>
            {t('Back to Models')}
          </Button>
        </div>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      <div className='mx-auto max-w-5xl px-4 sm:px-6'>
        <Button
          variant='ghost'
          size='sm'
          onClick={handleBack}
          className='text-muted-foreground hover:text-foreground mb-4 h-auto gap-1 px-0 py-1 text-xs'
        >
          <ArrowLeft className='size-3.5' />
          {t('Back')}
        </Button>

        <ModelDetailsContent
          model={model}
          groupRatio={groupRatio || {}}
          usableGroup={usableGroup || {}}
          autoGroups={autoGroups || []}
          priceRate={priceRate ?? 1}
          usdExchangeRate={usdExchangeRate ?? 1}
          tokenUnit={tokenUnit}
          showRechargePrice={search.rechargePrice ?? false}
          endpointMap={
            (endpointMap as Record<
              string,
              { path?: string; method?: string }
            >) || {}
          }
        />
      </div>
    </PublicLayout>
  )
}
