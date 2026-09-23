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
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  Code2,
  Download,
  Plus,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { type UseFormReturn, useFieldArray, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Combobox } from '@/components/ui/combobox'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getPricing } from '@/features/pricing/api'
import {
  getTokenUnitPrice,
  toOfficiallyPricedModel,
} from '@/features/pricing/lib/price'
import { formatDiscount } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  buildCostPricingRow,
  formatMarginRate,
  formatUsdPerMillion,
  marginRateFromMarkupPercent,
  MAX_MARKUP_PERCENT,
  summarizeCostPricingRows,
  type ChannelFormValues,
} from '../../../lib'

type ChannelPricingSectionProps = {
  form: UseFormReturn<ChannelFormValues>
  /** Same option list the models field uses, so a row can be picked not typed. */
  modelOptions: Array<{ value: string; label: string }>
  /**
   * The upstream names this channel will actually request, already walked
   * through `model_mapping`. Drives the one-click fill and the coverage figure:
   * cost is keyed by upstream name, so the published list alone would offer the
   * wrong keys on any channel that remaps.
   */
  upstreamModels?: string[]
  /**
   * Gates the vendor list price request. The drawer stays mounted for the whole
   * channels page and the catalog payload is large, so the query only runs
   * while the drawer is actually open.
   */
  enabled: boolean
  disabled?: boolean
  id?: string
  className?: string
}

/** Above this the list stops being scannable and the filter box appears. */
const SEARCH_VISIBILITY_THRESHOLD = 6

/** One-tap markups, spanning the range an operator actually reaches for. */
const MARKUP_PRESETS = [10, 20, 30, 50]

/**
 * Shared column geometry. A real `<table>` with fixed widths rather than a grid
 * per row: the header and the body must agree on where every column starts, and
 * two independent grids size themselves against different content.
 *
 * The model column takes the slack (`w-auto`) because it is the only one whose
 * content varies in width; the numeric columns are pinned so the digits line up
 * down the table. `min-w` on the table keeps the inputs usable when the drawer
 * is narrower than the sum of those widths — then, and only then, the container
 * scrolls sideways.
 */
const TABLE_MIN_WIDTH = 'min-w-[40rem]'

type PairSide = {
  text: string
  /** Tints the value — used where a sell price lands above the vendor's list. */
  alert?: boolean
}

/**
 * One derived money cell: the input figure over the output figure.
 *
 * Stacked rather than `a / b` on one line because the pair is what made these
 * columns unreadable. `67.5% off / 56.7% off` is 21 characters, so a one-line
 * discount cell either needs a third of the table's width or spills over its
 * neighbour — which is exactly what it did. Stacked, every money column fits in
 * 5rem, and input lines up with input across sell / official / discount.
 *
 * Collapses to a single line when both sides agree, so a model priced flat does
 * not print the same number twice.
 */
function StackedPair(props: { input: PairSide; output: PairSide }) {
  const { input, output } = props
  const collapsed =
    input.text === output.text && Boolean(input.alert) === Boolean(output.alert)

  return (
    <div className='flex flex-col items-end leading-tight'>
      <span className={cn(input.alert && 'text-warning')}>{input.text}</span>
      {!collapsed && (
        <span
          className={cn(
            'text-muted-foreground/90',
            output.alert && 'text-warning'
          )}
        >
          {output.text}
        </span>
      )}
    </div>
  )
}

function SummaryStat(props: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'muted'
}) {
  return (
    <div className='border-border/60 bg-card flex min-w-0 flex-col justify-center gap-1 rounded-lg border px-3 py-2.5'>
      <span className='text-muted-foreground truncate text-[11px] font-medium'>
        {props.label}
      </span>
      <span
        className={cn(
          'font-mono text-lg leading-none font-semibold tracking-tight tabular-nums',
          props.tone === 'muted' && 'text-muted-foreground'
        )}
      >
        {props.value}
      </span>
      {props.hint && (
        <span className='text-muted-foreground/80 truncate text-[11px]'>
          {props.hint}
        </span>
      )}
    </div>
  )
}

export function ChannelPricingSection(props: ChannelPricingSectionProps) {
  const { t } = useTranslation()
  const { form } = props
  const [search, setSearch] = useState('')

  const costModelsField = useFieldArray({
    control: form.control,
    name: 'cost_models',
  })

  const channelMarkupPercent = form.watch('cost_markup_percent')
  const costJson = form.watch('cost_json')
  // `useWatch`, not `form.watch`: the latter hands back the same array instance
  // after a nested edit, so a `useMemo` keyed on it never recomputes and the
  // derived columns freeze at their first value while the input visibly changes.
  const costModels = useWatch({ control: form.control, name: 'cost_models' })

  const { data: pricingData, isLoading: isLoadingPricing } = useQuery({
    queryKey: ['pricing'],
    queryFn: getPricing,
    staleTime: 5 * 60 * 1000,
    enabled: props.enabled,
  })

  // Vendor list price per model in USD / 1M tokens, the same unit as the buy
  // price inputs. Official ratios are swapped into the shared pricing pipeline
  // rather than multiplied by hand, and no group ratio is applied: the baseline
  // is what the vendor publishes, not what any group here pays.
  const officialPriceByModel = useMemo(() => {
    const byModel = new Map<string, { input: number; output: number }>()
    for (const model of pricingData?.data ?? []) {
      const official = toOfficiallyPricedModel(model)
      if (!official) continue
      byModel.set(model.model_name, {
        input: getTokenUnitPrice(official, 'input', 'M', false, 1, 1, 1),
        output: getTokenUnitPrice(official, 'output', 'M', false, 1, 1, 1),
      })
    }
    return byModel
  }, [pricingData])

  const pricingRows = useMemo(
    () =>
      (costModels ?? []).map((row) =>
        buildCostPricingRow(
          {
            model: row.model,
            input: row.input,
            output: row.output,
            markupPercent: row.markup_percent,
          },
          channelMarkupPercent,
          row.model?.trim()
            ? officialPriceByModel.get(row.model.trim())
            : undefined
        )
      ),
    [costModels, channelMarkupPercent, officialPriceByModel]
  )

  const summary = useMemo(
    () => summarizeCostPricingRows(pricingRows),
    [pricingRows]
  )
  // Suppressed while the catalog is still in flight: every row looks unpriced
  // during the first render pass, and a warning that retracts itself trains the
  // operator to ignore the next one.
  const modelsMissingOfficialPrice = isLoadingPricing
    ? []
    : summary.modelsMissingOfficialPrice

  const upstreamModels = props.upstreamModels ?? []
  const pricedModelNames = useMemo(
    () =>
      new Set(
        (costModels ?? [])
          .map((row) => row.model?.trim())
          .filter((model): model is string => Boolean(model))
      ),
    [costModels]
  )
  const unpricedUpstreamModels = upstreamModels.filter(
    (model) => !pricedModelNames.has(model)
  )

  const rawJsonActive = Boolean(costJson?.trim())
  const visibleIndexes = useMemo(() => {
    const query = search.trim().toLowerCase()
    const indexes = costModelsField.fields.map((_, index) => index)
    if (!query) return indexes
    // Rows are hidden, never re-ordered or filtered out of the array: the field
    // array's index is the form path, so a filtered `map` would write edits to
    // whichever row happens to sit at that position in the filtered view.
    return indexes.filter((index) =>
      (costModels?.[index]?.model ?? '').toLowerCase().includes(query)
    )
  }, [costModelsField.fields, costModels, search])

  const appendModelRow = (model: string) => {
    // A search that hid the new row would read as the click doing nothing.
    setSearch('')
    costModelsField.append({ model })
  }

  const importUpstreamModels = () => {
    if (unpricedUpstreamModels.length === 0) return
    setSearch('')
    for (const model of unpricedUpstreamModels) {
      costModelsField.append({ model })
    }
    toast.success(
      t('Added {{count}} model(s) to the pricing table', {
        count: unpricedUpstreamModels.length,
      })
    )
  }

  /** 折/`% off` per locale, with the raw multiplier as the above-list fallback. */
  const renderDiscount = (fraction: number | null): string => {
    if (fraction == null || !Number.isFinite(fraction)) return '-'
    return formatDiscount(fraction, t) ?? `${Number(fraction.toFixed(2))}x`
  }

  const channelMarginRate = marginRateFromMarkupPercent(channelMarkupPercent)
  const coverageValue = `${summary.pricedCount}${
    upstreamModels.length > 0 ? ` / ${upstreamModels.length}` : ''
  }`

  /**
   * Coverage reads against what the channel actually requests, so the hint has
   * three states: how many are unpriced, an all-clear, or nothing at all when
   * the upstream list is unknown and there is no denominator to speak of.
   */
  let coverageHint: string | undefined
  if (unpricedUpstreamModels.length > 0) {
    coverageHint = t('{{count}} not priced', {
      count: unpricedUpstreamModels.length,
    })
  } else if (upstreamModels.length > 0) {
    coverageHint = t('All channel models priced')
  }

  return (
    // No section header: the tab strip directly above already names this panel
    // and carries the same icon, and a second copy of both cost the table the
    // only vertical space it was short of.
    <section
      id={props.id}
      className={cn('flex min-h-0 flex-1 flex-col gap-3', props.className)}
    >
      <fieldset
        disabled={props.disabled}
        className='flex min-h-0 flex-1 flex-col gap-3 disabled:opacity-60'
      >
        {/* ── Channel markup + what it implies ── */}
        <div className='grid gap-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)]'>
          <div className='border-border/60 from-primary/[0.07] bg-card flex min-w-0 flex-col gap-2 rounded-lg border bg-linear-to-br to-transparent px-3 py-2.5'>
            <FormField
              control={form.control}
              name='cost_markup_percent'
              render={({ field }) => (
                <FormItem className='gap-2'>
                  <div className='flex items-center gap-2'>
                    <FormControl>
                      <div className='relative w-24 shrink-0'>
                        <Input
                          type='number'
                          min={0}
                          max={MAX_MARKUP_PERCENT}
                          step={1}
                          aria-label={t('Channel markup')}
                          className='h-9 pr-7 font-mono text-base font-semibold tabular-nums'
                          value={
                            typeof field.value === 'number' &&
                            Number.isFinite(field.value)
                              ? field.value
                              : ''
                          }
                          onChange={(event) => {
                            const next = event.target.valueAsNumber
                            field.onChange(Number.isFinite(next) ? next : 0)
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                        <span
                          className='text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs'
                          aria-hidden='true'
                        >
                          %
                        </span>
                      </div>
                    </FormControl>
                    <div className='flex min-w-0 flex-col gap-1'>
                      <span className='text-xs font-medium'>
                        {t('Channel markup')}
                      </span>
                      <div className='flex flex-wrap gap-1'>
                        {MARKUP_PRESETS.map((preset) => (
                          <Button
                            key={preset}
                            type='button'
                            size='sm'
                            variant={
                              channelMarkupPercent === preset
                                ? 'secondary'
                                : 'ghost'
                            }
                            className='h-5 rounded-full px-1.5 text-[11px] font-medium tabular-nums'
                            onClick={() =>
                              form.setValue('cost_markup_percent', preset, {
                                shouldDirty: true,
                                shouldValidate: true,
                              })
                            }
                          >
                            {preset}%
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className='text-muted-foreground border-border/50 border-t pt-2 text-[11px] leading-4'>
              {t('Sell price = buy price × (1 + markup)')}
            </p>
          </div>

          <div className='grid min-w-0 grid-cols-3 gap-2'>
            <SummaryStat
              label={t('Margin rate')}
              value={formatMarginRate(channelMarginRate)}
              hint={t('markup ÷ (1 + markup)')}
            />
            <SummaryStat
              label={t('Priced models')}
              value={coverageValue}
              tone={summary.pricedCount === 0 ? 'muted' : 'default'}
              hint={coverageHint}
            />
            <SummaryStat
              label={t('Median discount')}
              value={
                summary.medianDiscountFraction == null
                  ? '-'
                  : renderDiscount(summary.medianDiscountFraction)
              }
              tone={
                summary.medianDiscountFraction == null ? 'muted' : 'default'
              }
              hint={t('vs official price')}
            />
          </div>
        </div>

        {rawJsonActive && (
          <div className='border-warning/40 bg-warning/10 text-warning flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-xs'>
            <TriangleAlert className='size-4 shrink-0' aria-hidden='true' />
            <span className='min-w-0 flex-1'>
              {t(
                'Raw JSON is set, so it is saved instead of the table below. Clear it to go back to the table.'
              )}
            </span>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='h-6 shrink-0 px-2 text-xs'
              onClick={() =>
                form.setValue('cost_json', '', {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            >
              {t('Clear JSON')}
            </Button>
          </div>
        )}

        {/* ── The table card: toolbar, scrolling body, footer ── */}
        <div
          className={cn(
            'border-border/60 bg-card flex min-h-[15rem] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border',
            rawJsonActive && 'opacity-55'
          )}
        >
          <div className='border-border/60 flex flex-wrap items-center gap-2 border-b px-3 py-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <h3 className='text-[13px] font-semibold tracking-tight'>
                {t('Buy price')}
              </h3>
              <Badge variant='secondary' className='tabular-nums'>
                {summary.namedCount}
              </Badge>
              <span className='text-muted-foreground hidden text-[11px] sm:inline'>
                {t('USD / 1M tokens')}
              </span>
            </div>

            <div className='ml-auto flex items-center gap-1.5'>
              {costModelsField.fields.length >= SEARCH_VISIBILITY_THRESHOLD && (
                <div className='relative w-36'>
                  <Search
                    className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2'
                    aria-hidden='true'
                  />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('Search models...')}
                    aria-label={t('Search models...')}
                    className='h-7 pr-7 pl-7 text-xs'
                  />
                  {search && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={t('Clear search')}
                      className='absolute top-1/2 right-0.5 size-6 -translate-y-1/2'
                      onClick={() => setSearch('')}
                    >
                      <X className='size-3.5' aria-hidden='true' />
                    </Button>
                  )}
                </div>
              )}
              {unpricedUpstreamModels.length > 0 && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-7 px-2 text-xs'
                  onClick={importUpstreamModels}
                >
                  <Download className='size-3.5' aria-hidden='true' />
                  {t('Import channel models')}
                  <span className='text-muted-foreground tabular-nums'>
                    {unpricedUpstreamModels.length}
                  </span>
                </Button>
              )}
              <Button
                type='button'
                size='sm'
                className='h-7 px-2 text-xs'
                onClick={() => appendModelRow('')}
              >
                <Plus className='size-3.5' aria-hidden='true' />
                {t('Add model')}
              </Button>
            </div>
          </div>

          {costModelsField.fields.length === 0 ? (
            <Empty className='flex-1 border-0'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Tags aria-hidden='true' />
                </EmptyMedia>
                <EmptyTitle>{t('No model priced yet')}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    'Without a buy price this channel has no margin figure. Add the models you buy from this vendor and type what you pay.'
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <div className='flex flex-wrap justify-center gap-2'>
                  {unpricedUpstreamModels.length > 0 && (
                    <Button type='button' onClick={importUpstreamModels}>
                      <Download className='size-4' aria-hidden='true' />
                      {t('Import channel models')}
                    </Button>
                  )}
                  <Button
                    type='button'
                    variant={
                      unpricedUpstreamModels.length > 0 ? 'outline' : 'default'
                    }
                    onClick={() => appendModelRow('')}
                  >
                    <Plus className='size-4' aria-hidden='true' />
                    {t('Add model')}
                  </Button>
                </div>
              </EmptyContent>
            </Empty>
          ) : (
            <div className='min-h-0 flex-1 overflow-auto overscroll-contain'>
              <table
                className={cn(
                  'w-full table-fixed border-collapse',
                  TABLE_MIN_WIDTH
                )}
              >
                <thead className='bg-card sticky top-0 z-10'>
                  <tr className='border-border/60 text-muted-foreground border-b text-[11px] font-medium'>
                    <th scope='col' className='w-auto px-3 py-2 text-left'>
                      {t('Model')}
                    </th>
                    <th
                      scope='col'
                      className='w-[10.25rem] px-2 py-2 text-left'
                    >
                      {t('Buy price')}
                      <span className='text-muted-foreground/70 ml-1 font-normal'>
                        {t('input / output')}
                      </span>
                    </th>
                    <th
                      scope='col'
                      className='w-[5rem] px-2 py-2 text-right leading-tight'
                    >
                      {t('Sell price')}
                    </th>
                    <th
                      scope='col'
                      className='hidden w-[4.75rem] px-2 py-2 text-right leading-tight xl:table-cell'
                    >
                      {t('Official price')}
                    </th>
                    <th
                      scope='col'
                      className='w-[5.25rem] px-2 py-2 text-right leading-tight'
                    >
                      {t('Discount off official')}
                    </th>
                    <th
                      scope='col'
                      className='w-[7.5rem] px-2 py-2 text-right leading-tight'
                    >
                      {t('Markup')}
                    </th>
                    <th scope='col' className='w-10 px-2 py-2'>
                      <span className='sr-only'>{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIndexes.length === 0 && (
                    <tr>
                      <td colSpan={7} className='px-3 py-8 text-center'>
                        <p className='text-muted-foreground text-xs'>
                          {t('No models found.')}
                        </p>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='mt-1 h-7 text-xs'
                          onClick={() => setSearch('')}
                        >
                          {t('Clear search')}
                        </Button>
                      </td>
                    </tr>
                  )}

                  {visibleIndexes.map((index) => {
                    const field = costModelsField.fields[index]
                    const row = pricingRows[index]
                    const modelName = row?.model ?? ''
                    // A name the channel will never request is not rejected —
                    // the operator may be pricing ahead of adding the model —
                    // but it silently bills nothing, so it is flagged.
                    const unservedModel =
                      Boolean(modelName) &&
                      upstreamModels.length > 0 &&
                      !upstreamModels.includes(modelName)

                    return (
                      <tr
                        key={field.id}
                        className='border-border/50 border-b last:border-b-0'
                      >
                        <td className='px-3 py-1.5 align-middle'>
                          <div className='flex items-center gap-1.5'>
                            <FormField
                              control={form.control}
                              name={`cost_models.${index}.model`}
                              render={({ field: modelField }) => (
                                <FormItem className='min-w-0 flex-1'>
                                  <FormControl>
                                    <Combobox
                                      options={props.modelOptions}
                                      value={modelField.value ?? ''}
                                      onValueChange={modelField.onChange}
                                      placeholder='model-name'
                                      searchPlaceholder={t('Search models...')}
                                      emptyText={t('No models found.')}
                                      allowCustomValue
                                      openOnFocus={false}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            {unservedModel && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span
                                      className='text-warning shrink-0 cursor-help'
                                      aria-label={t(
                                        'This channel does not request this model, so the buy price will never apply.'
                                      )}
                                    />
                                  }
                                >
                                  <TriangleAlert
                                    className='size-4'
                                    aria-hidden='true'
                                  />
                                </TooltipTrigger>
                                <TooltipContent className='max-w-64'>
                                  {t(
                                    'This channel does not request this model, so the buy price will never apply.'
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>

                        <td className='px-2 py-1.5 align-middle'>
                          <div className='flex items-center gap-1'>
                            <FormField
                              control={form.control}
                              name={`cost_models.${index}.input`}
                              render={({ field: inputField }) => (
                                <FormItem className='min-w-0 flex-1'>
                                  <FormControl>
                                    <Input
                                      type='number'
                                      min={0}
                                      step={0.01}
                                      placeholder='0.00'
                                      aria-label={t('Buy price (input)')}
                                      className='h-8 px-2 text-right font-mono text-xs tabular-nums'
                                      value={
                                        typeof inputField.value === 'number' &&
                                        Number.isFinite(inputField.value)
                                          ? inputField.value
                                          : ''
                                      }
                                      onChange={(event) => {
                                        const next = event.target.valueAsNumber
                                        inputField.onChange(
                                          Number.isFinite(next)
                                            ? next
                                            : undefined
                                        )
                                      }}
                                      onBlur={inputField.onBlur}
                                      name={inputField.name}
                                      ref={inputField.ref}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <span
                              className='text-muted-foreground/60 shrink-0 text-xs'
                              aria-hidden='true'
                            >
                              /
                            </span>
                            <FormField
                              control={form.control}
                              name={`cost_models.${index}.output`}
                              render={({ field: outputField }) => (
                                <FormItem className='min-w-0 flex-1'>
                                  <FormControl>
                                    <Input
                                      type='number'
                                      min={0}
                                      step={0.01}
                                      placeholder='0.00'
                                      aria-label={t('Buy price (output)')}
                                      className='h-8 px-2 text-right font-mono text-xs tabular-nums'
                                      value={
                                        typeof outputField.value === 'number' &&
                                        Number.isFinite(outputField.value)
                                          ? outputField.value
                                          : ''
                                      }
                                      onChange={(event) => {
                                        const next = event.target.valueAsNumber
                                        outputField.onChange(
                                          Number.isFinite(next)
                                            ? next
                                            : undefined
                                        )
                                      }}
                                      onBlur={outputField.onBlur}
                                      name={outputField.name}
                                      ref={outputField.ref}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        </td>

                        <td className='px-2 py-1.5 align-middle font-mono text-xs font-semibold tabular-nums'>
                          <StackedPair
                            input={{
                              text: formatUsdPerMillion(row?.input.sellPrice),
                            }}
                            output={{
                              text: formatUsdPerMillion(row?.output.sellPrice),
                            }}
                          />
                        </td>

                        <td className='text-muted-foreground hidden px-2 py-1.5 align-middle font-mono text-xs tabular-nums xl:table-cell'>
                          {isLoadingPricing ? (
                            <Skeleton className='ml-auto h-3.5 w-12' />
                          ) : (
                            <StackedPair
                              input={{
                                text: formatUsdPerMillion(
                                  row?.input.officialPrice
                                ),
                              }}
                              output={{
                                text: formatUsdPerMillion(
                                  row?.output.officialPrice
                                ),
                              }}
                            />
                          )}
                        </td>

                        <td className='px-2 py-1.5 align-middle text-xs tabular-nums'>
                          {isLoadingPricing ? (
                            <Skeleton className='ml-auto h-3.5 w-10' />
                          ) : (
                            // Above list is tinted rather than merely printed:
                            // a sell price over the vendor's own rate is a
                            // pricing fault the operator has to see, and
                            // `4.26x` reads like just another number.
                            <StackedPair
                              input={{
                                text: renderDiscount(
                                  row?.input.discountFraction ?? null
                                ),
                                alert: (row?.input.discountFraction ?? 0) > 1,
                              }}
                              output={{
                                text: renderDiscount(
                                  row?.output.discountFraction ?? null
                                ),
                                alert: (row?.output.discountFraction ?? 0) > 1,
                              }}
                            />
                          )}
                        </td>

                        <td className='px-2 py-1.5 align-middle'>
                          <div className='flex items-center justify-end gap-0.5'>
                            <FormField
                              control={form.control}
                              name={`cost_models.${index}.markup_percent`}
                              render={({ field: markupField }) => (
                                <FormItem className='min-w-0 flex-1'>
                                  <FormControl>
                                    <div className='relative'>
                                      <Input
                                        type='number'
                                        min={0}
                                        max={MAX_MARKUP_PERCENT}
                                        step={1}
                                        // The channel value as the placeholder is
                                        // the whole affordance: an empty box that
                                        // shows what it will inherit, and typing
                                        // over it is the override. The previous
                                        // "Override markup" button made a
                                        // two-step ritual out of one number.
                                        placeholder={String(
                                          channelMarkupPercent ?? 0
                                        )}
                                        aria-label={t('Override markup')}
                                        className='h-8 pr-5 pl-2 text-right font-mono text-xs tabular-nums'
                                        value={
                                          typeof markupField.value ===
                                            'number' &&
                                          Number.isFinite(markupField.value)
                                            ? markupField.value
                                            : ''
                                        }
                                        onChange={(event) => {
                                          const next =
                                            event.target.valueAsNumber
                                          // Blanking the box reverts to the
                                          // channel markup rather than pinning
                                          // the last number typed.
                                          markupField.onChange(
                                            Number.isFinite(next)
                                              ? next
                                              : undefined
                                          )
                                        }}
                                        onBlur={markupField.onBlur}
                                        name={markupField.name}
                                        ref={markupField.ref}
                                      />
                                      <span
                                        className='text-muted-foreground/70 pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[10px]'
                                        aria-hidden='true'
                                      >
                                        %
                                      </span>
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              className={cn(
                                'text-muted-foreground hover:text-foreground size-7 shrink-0',
                                row?.inheritsChannelMarkup && 'invisible'
                              )}
                              aria-label={t('Use channel markup')}
                              tabIndex={row?.inheritsChannelMarkup ? -1 : 0}
                              onClick={() =>
                                // `update`, not `setValue`: clearing the key on a
                                // useFieldArray-controlled row has to go through
                                // the array for the watch to see it.
                                costModelsField.update(index, {
                                  ...(costModels?.[index] ?? { model: '' }),
                                  markup_percent: undefined,
                                })
                              }
                            >
                              <RotateCcw
                                className='size-3.5'
                                aria-hidden='true'
                              />
                            </Button>
                          </div>
                        </td>

                        <td className='px-2 py-1.5 align-middle'>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            className='text-muted-foreground hover:text-destructive size-7'
                            aria-label={t('Remove model price')}
                            onClick={() => costModelsField.remove(index)}
                          >
                            <Trash2 className='size-3.5' aria-hidden='true' />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}

                  {/* Turns the dead space under the last row into the affordance
                      it was already shaped like. Hidden while searching, where a
                      filtered list has no meaningful "end" to append to. */}
                  {!search && (
                    <tr>
                      <td colSpan={7} className='px-2 pt-1.5 pb-0.5'>
                        <button
                          type='button'
                          onClick={() => appendModelRow('')}
                          className='text-muted-foreground hover:border-primary/50 hover:text-foreground focus-visible:ring-ring flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none'
                        >
                          <Plus className='size-3.5' aria-hidden='true' />
                          {t('Add model')}
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Footer strip: what is missing, and the escape hatch ── */}
        <div className='flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5'>
          {/* Lives here, not in the column head: at 6rem the header cannot hold
              both the label and the explanation without breaking mid-word. */}
          <span className='text-muted-foreground/80 text-[11px]'>
            {t('A blank markup follows the channel markup.')}
          </span>
          {modelsMissingOfficialPrice.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className='text-muted-foreground hover:text-foreground flex min-w-0 cursor-help items-center gap-1.5 text-[11px]' />
                }
              >
                <AlertCircle className='size-3.5 shrink-0' aria-hidden='true' />
                <span className='truncate'>
                  {t('{{count}} model(s) have no official price', {
                    count: modelsMissingOfficialPrice.length,
                  })}
                </span>
              </TooltipTrigger>
              <TooltipContent className='max-w-80'>
                {t(
                  'No official price synced for {{models}}, so the discount cannot be computed. Pricing still saves and still applies.',
                  { models: modelsMissingOfficialPrice.join(', ') }
                )}
              </TooltipContent>
            </Tooltip>
          )}

          <Collapsible
            defaultOpen={rawJsonActive}
            className='ml-auto min-w-0 basis-full sm:basis-auto'
          >
            <CollapsibleTrigger
              render={
                <button
                  type='button'
                  className='text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1.5 text-[11px] font-medium'
                />
              }
            >
              <Code2 className='size-3.5' aria-hidden='true' />
              {t('Advanced (raw JSON)')}
            </CollapsibleTrigger>
            <CollapsibleContent className='mt-2'>
              <FormField
                control={form.control}
                name='cost_json'
                render={({ field }) => (
                  <FormItem>
                    <FormDescription className='text-[11px]'>
                      {t(
                        'Overrides the table above when set. Full cost object: default_markup, models (per-model input/output/markup plus cache, audio, image, reasoning and per_call prices).'
                      )}
                    </FormDescription>
                    <FormControl>
                      <Textarea
                        rows={6}
                        className='font-mono text-xs'
                        placeholder='{}'
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </fieldset>
    </section>
  )
}
