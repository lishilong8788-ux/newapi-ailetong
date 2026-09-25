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
/**
 * Channel pricing: one markup for the channel, one price sheet per model.
 *
 * Laid out as a rail of models beside the selected model's sheet, because
 * pricing a model means filling in up to eleven numbers and a table row cannot
 * hold eleven inputs. The previous shape put three of them in the row and the
 * other eight in a panel underneath, which read as two unrelated controls and
 * hid the fact that all eleven are the same kind of number.
 */
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  Code2,
  Download,
  Plus,
  Tags,
  TriangleAlert,
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
  COST_PRICING_KINDS,
  marginRateFromMarkupPercent,
  summarizeCostPricingRows,
  type ChannelFormValues,
  type CostPricingKind,
} from '../../../lib'
import { ChannelMarkupSummary } from './pricing/channel-markup-summary'
import { ModelPriceList } from './pricing/model-price-list'
import { ModelPriceSheet } from './pricing/model-price-sheet'

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

/** Above this the rail stops being scannable and the filter box appears. */
const SEARCH_VISIBILITY_THRESHOLD = 6

/**
 * Drops `removed` out of a set of row indexes and shifts the rest down, keeping
 * per-row UI state pinned to the same row after a removal. Without the shift,
 * deleting a row hands its state to whichever row slid into its place.
 */
function shiftIndexesAfterRemoval(
  indexes: Set<number>,
  removed: number
): Set<number> {
  const next = new Set<number>()
  for (const index of indexes) {
    if (index === removed) continue
    next.add(index > removed ? index - 1 : index)
  }
  return next
}

export function ChannelPricingSection(props: ChannelPricingSectionProps) {
  const { t } = useTranslation()
  const { form } = props
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  // Rows switched to per-request pricing but with no price typed yet. Without
  // it the mode toggle would snap back the instant it was clicked, since an
  // empty per_call field reads as per-token mode.
  const [perCallIndexes, setPerCallIndexes] = useState<Set<number>>(
    () => new Set()
  )

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
    const byModel = new Map<
      string,
      { input: number; output: number; cacheRead: number }
    >()
    for (const model of pricingData?.data ?? []) {
      const official = toOfficiallyPricedModel(model)
      if (!official) continue
      byModel.set(model.model_name, {
        input: getTokenUnitPrice(official, 'input', 'M', false, 1, 1, 1),
        output: getTokenUnitPrice(official, 'output', 'M', false, 1, 1, 1),
        // NaN when the vendor publishes no cached-read rate. toDimension treats
        // it as "no official price", which is what it is.
        cacheRead: getTokenUnitPrice(official, 'cache', 'M', false, 1, 1, 1),
      })
    }
    return byModel
  }, [pricingData])

  const pricingRows = useMemo(
    () =>
      (costModels ?? []).map((row) => {
        const costs = {} as Record<CostPricingKind, number | undefined>
        for (const kind of COST_PRICING_KINDS) {
          costs[kind.key] = row[kind.key]
        }
        return buildCostPricingRow(
          { model: row.model, markupPercent: row.markup_percent, costs },
          channelMarkupPercent,
          row.model?.trim()
            ? officialPriceByModel.get(row.model.trim())
            : undefined
        )
      }),
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

  // Derived, not stored: a search that hides the selected row would otherwise
  // leave the sheet showing a model the rail no longer lists.
  const activeIndex = visibleIndexes.includes(selectedIndex)
    ? selectedIndex
    : (visibleIndexes[0] ?? null)
  const activeRow = activeIndex == null ? undefined : pricingRows[activeIndex]

  const appendModelRow = (model: string) => {
    // A search that hid the new row would read as the click doing nothing.
    setSearch('')
    costModelsField.append({ model })
    setSelectedIndex(costModelsField.fields.length)
  }

  const importUpstreamModels = () => {
    if (unpricedUpstreamModels.length === 0) return
    setSearch('')
    const firstNewIndex = costModelsField.fields.length
    for (const model of unpricedUpstreamModels) {
      costModelsField.append({ model })
    }
    setSelectedIndex(firstNewIndex)
    toast.success(
      t('Added {{count}} model(s) to the pricing table', {
        count: unpricedUpstreamModels.length,
      })
    )
  }

  const removeModelRow = (index: number) => {
    costModelsField.remove(index)
    setPerCallIndexes((current) => shiftIndexesAfterRemoval(current, index))
    // Land on the neighbour rather than on nothing: the pane would otherwise go
    // empty while rows are still listed beside it.
    const lastIndex = costModelsField.fields.length - 2
    setSelectedIndex(Math.max(0, Math.min(index, lastIndex)))
  }

  const setPerCallMode = (index: number, perCall: boolean) => {
    setPerCallIndexes((current) => {
      const next = new Set(current)
      if (perCall) next.add(index)
      else next.delete(index)
      return next
    })
    if (perCall) return
    // Leaving per-request mode has to clear the price, or the backend keeps
    // taking the per_call branch while the sheet shows token prices.
    //
    // `update` drops the key from the form value, and `unregister` drops the
    // field RHF cached for the box that just unmounted — without the second
    // call the old number comes straight back the next time the box is shown,
    // reading as a price that is set when the form no longer holds one.
    costModelsField.update(index, {
      ...(costModels?.[index] ?? { model: '' }),
      per_call: undefined,
    })
    form.unregister(`cost_models.${index}.per_call`, { keepDirty: true })
  }

  /** 折/`% off` per locale, with the raw multiplier as the above-list fallback. */
  const renderDiscount = (fraction: number | null): string => {
    if (fraction == null || !Number.isFinite(fraction)) return '-'
    return formatDiscount(fraction, t) ?? `${Number(fraction.toFixed(2))}x`
  }

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
    // and carries the same icon, and a second copy of both cost the editor the
    // only vertical space it was short of.
    <section
      id={props.id}
      className={cn('flex min-h-0 flex-1 flex-col gap-2.5', props.className)}
    >
      <fieldset
        disabled={props.disabled}
        className='flex min-h-0 flex-1 flex-col gap-2.5 disabled:opacity-60'
      >
        <ChannelMarkupSummary
          form={form}
          channelMarkupPercent={channelMarkupPercent}
          marginRate={marginRateFromMarkupPercent(channelMarkupPercent)}
          coverageValue={coverageValue}
          coverageHint={coverageHint}
          medianDiscountText={
            summary.medianDiscountFraction == null
              ? '-'
              : renderDiscount(summary.medianDiscountFraction)
          }
          hasMedianDiscount={summary.medianDiscountFraction != null}
        />

        {rawJsonActive && (
          <div className='border-warning/40 bg-warning/10 text-warning flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-xs'>
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

        <div
          className={cn(
            'border-border/60 bg-card flex min-h-[18rem] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border',
            rawJsonActive && 'opacity-55'
          )}
        >
          <div className='border-border/60 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2'>
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
            <div className='flex min-h-0 flex-1 flex-col lg:flex-row'>
              <ModelPriceList
                rowIds={costModelsField.fields.map((field) => field.id)}
                visibleIndexes={visibleIndexes}
                rows={pricingRows}
                selectedIndex={activeIndex}
                onSelect={setSelectedIndex}
                search={search}
                onSearchChange={setSearch}
                showSearch={
                  costModelsField.fields.length >= SEARCH_VISIBILITY_THRESHOLD
                }
                onAdd={() => appendModelRow('')}
                className='border-border/60 max-h-52 shrink-0 border-b lg:max-h-none lg:w-56 lg:border-r lg:border-b-0'
              />

              {activeIndex == null ? (
                <div className='flex min-h-0 flex-1 items-center justify-center p-6'>
                  <p className='text-muted-foreground text-xs'>
                    {t('Pick a model on the left to price it.')}
                  </p>
                </div>
              ) : (
                <ModelPriceSheet
                  // Keyed on the index, never on the field id: the id changes
                  // on every `update()`, and remounting mid-update lets a box
                  // re-register and write its old value back, which is how
                  // clearing a price silently failed. The index only changes
                  // when the operator picks another model — exactly when the
                  // boxes should start over.
                  key={activeIndex}
                  form={form}
                  index={activeIndex}
                  row={activeRow}
                  channelMarkupPercent={channelMarkupPercent}
                  modelOptions={props.modelOptions}
                  isLoadingOfficialPrice={isLoadingPricing}
                  unservedModel={
                    // A name the channel will never request is not rejected —
                    // the operator may be pricing ahead of adding the model —
                    // but it silently bills nothing, so it is flagged.
                    Boolean(activeRow?.model) &&
                    upstreamModels.length > 0 &&
                    !upstreamModels.includes(activeRow?.model ?? '')
                  }
                  perCallMode={
                    activeRow?.kinds.per_call.cost != null ||
                    perCallIndexes.has(activeIndex)
                  }
                  onPerCallModeChange={(perCall) =>
                    setPerCallMode(activeIndex, perCall)
                  }
                  onResetMarkup={() =>
                    costModelsField.update(activeIndex, {
                      ...(costModels?.[activeIndex] ?? { model: '' }),
                      markup_percent: undefined,
                    })
                  }
                  onRemove={() => removeModelRow(activeIndex)}
                  renderDiscount={renderDiscount}
                />
              )}
            </div>
          )}
        </div>

        {/* ── Footer strip: what is missing, and the escape hatch ── */}
        <div className='flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5'>
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
                        'Overrides the table above when set. Full cost object: default_markup, models (per-model input/output/cache_read/markup plus cache write, audio, image, reasoning and per_call prices).'
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
