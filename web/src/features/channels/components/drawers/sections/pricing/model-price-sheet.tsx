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
 * The right-hand pane: one model's whole price sheet.
 *
 * Every dimension is a row of the same sheet, in one column layout — buy price,
 * the sell price it implies, and how that sits against the vendor's list price.
 * Input / output / cache are simply the first three rows. When they sat in a
 * table cell above a separate panel holding the other eight, the two read as
 * unrelated controls and the operator had no way to see that all eleven are the
 * same kind of number.
 */
import { RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  COST_PRICING_GROUPS,
  COST_PRICING_KINDS,
  formatMarginRate,
  formatUsdPerMillion,
  MAX_MARKUP_PERCENT,
  type ChannelFormValues,
  type CostPricingKind,
  type CostPricingRow,
} from '../../../../lib'
import { BuyPriceInput } from './cost-pricing-fields'
import { KIND_TEXT } from './cost-pricing-text'

export type ModelPriceSheetProps = {
  form: UseFormReturn<ChannelFormValues>
  /** Form-array index, which is the field path — not a position in a filtered view. */
  index: number
  row: CostPricingRow | undefined
  /** Inherited when the row's own markup box is blank; shown as its placeholder. */
  channelMarkupPercent: number | undefined
  modelOptions: Array<{ value: string; label: string }>
  /** True while the vendor catalog is still loading, so list prices are unknown. */
  isLoadingOfficialPrice: boolean
  /** True when this channel will never request the named model. */
  unservedModel: boolean
  perCallMode: boolean
  onPerCallModeChange: (perCall: boolean) => void
  /** Clears the row's markup override so it follows the channel again. */
  onResetMarkup: () => void
  onRemove: () => void
  renderDiscount: (fraction: number | null) => string
}

/**
 * Shared column geometry for the sheet. Header and rows read from the same
 * constant so the digits line up down the sheet; two independent grids would
 * each size themselves against their own content.
 */
const SHEET_GRID =
  'grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-x-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem]'

/** A sell price above the vendor's own list price is a fault, not a figure. */
function DerivedValue(props: {
  text: string
  alert?: boolean
  muted?: boolean
}) {
  return (
    <span
      className={cn(
        'truncate text-right font-mono text-xs tabular-nums',
        props.muted && 'text-muted-foreground',
        props.alert && 'text-warning'
      )}
    >
      {props.text}
    </span>
  )
}

function SheetRow(props: {
  form: UseFormReturn<ChannelFormValues>
  index: number
  kind: CostPricingKind
  row: CostPricingRow | undefined
  isLoadingOfficialPrice: boolean
  renderDiscount: (fraction: number | null) => string
}) {
  const { t } = useTranslation()
  const text = KIND_TEXT[props.kind]
  const dimension = props.row?.kinds[props.kind]
  const reach = COST_PRICING_KINDS.find(
    (kind) => kind.key === props.kind
  )?.reach
  // Image output and reasoning tokens are subsets of the completion count with
  // no ratio of their own, so a sell price here would claim a charge the
  // backend cannot make. The buy price still moves the margin report.
  const costOnly = reach === 'cost_only'
  const discountFraction = dimension?.discountFraction ?? null

  return (
    <div className='hover:bg-muted/40 rounded-md transition-colors'>
      <div className={cn(SHEET_GRID, 'px-2.5 py-1')}>
        <div className='flex min-w-0 items-center gap-1.5'>
          <span className='shrink-0 text-xs font-medium'>{t(text.label)}</span>
          {costOnly && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Badge
                    variant='outline'
                    className='shrink-0 cursor-help px-1.5 py-0 text-[10px] font-normal'
                  />
                }
              >
                {t('Cost only')}
              </TooltipTrigger>
              <TooltipContent className='max-w-64'>
                {t(
                  'These tokens bill at the output rate. The buy price here only feeds the margin report.'
                )}
              </TooltipContent>
            </Tooltip>
          )}
          <span className='text-muted-foreground/75 hidden truncate text-[11px] lg:inline'>
            {t(text.hint)}
          </span>
        </div>

        <BuyPriceInput
          form={props.form}
          index={props.index}
          kind={props.kind}
          label={t('Buy price ({{kind}})', { kind: t(text.label) })}
          placeholder={text.placeholder}
        />

        <DerivedValue
          text={costOnly ? '—' : formatUsdPerMillion(dimension?.sellPrice)}
          muted={costOnly || dimension?.sellPrice == null}
        />

        <div className='hidden min-w-0 flex-col items-end leading-tight sm:flex'>
          {props.isLoadingOfficialPrice ? (
            <Skeleton className='h-3.5 w-14' />
          ) : (
            <>
              <DerivedValue
                text={props.renderDiscount(discountFraction)}
                alert={(discountFraction ?? 0) > 1}
                muted={discountFraction == null}
              />
              <span className='text-muted-foreground/70 font-mono text-[10px] tabular-nums'>
                {formatUsdPerMillion(dimension?.officialPrice)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The per-model markup: an empty box whose placeholder is the channel markup it
 * will inherit, and typing over it is the whole override gesture. The reset
 * button only appears once there is something to reset.
 */
function ModelMarkupOverrideField(props: {
  form: UseFormReturn<ChannelFormValues>
  index: number
  channelMarkupPercent: number | undefined
  inherits: boolean
  onReset: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className='flex shrink-0 items-center gap-1.5'>
      <span className='text-muted-foreground text-[11px]'>{t('Markup')}</span>
      <FormField
        control={props.form.control}
        name={`cost_models.${props.index}.markup_percent`}
        render={({ field }) => (
          <FormItem className='w-20'>
            <FormControl>
              <div className='relative'>
                <Input
                  type='number'
                  min={0}
                  max={MAX_MARKUP_PERCENT}
                  step={1}
                  placeholder={String(props.channelMarkupPercent ?? 0)}
                  aria-label={t('Override markup')}
                  className='h-8 pr-5 pl-2 text-right font-mono text-xs tabular-nums'
                  value={
                    typeof field.value === 'number' &&
                    Number.isFinite(field.value)
                      ? field.value
                      : ''
                  }
                  onChange={(event) => {
                    const next = event.target.valueAsNumber
                    // Blanking reverts to the channel markup rather than
                    // pinning the last number typed.
                    field.onChange(Number.isFinite(next) ? next : undefined)
                  }}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
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
      {props.inherits ? (
        <span className='text-muted-foreground/70 text-[11px]'>
          {t('follows channel')}
        </span>
      ) : (
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='text-muted-foreground hover:text-foreground size-7 shrink-0'
          aria-label={t('Use channel markup')}
          onClick={props.onReset}
        >
          <RotateCcw className='size-3.5' aria-hidden='true' />
        </Button>
      )}
    </div>
  )
}

export function ModelPriceSheet(props: ModelPriceSheetProps) {
  const { t } = useTranslation()
  const perCallDimension = props.row?.kinds.per_call
  // Token prices are kept, not wiped, when the mode flips: the backend simply
  // stops reading them. Saying how many are parked is the honest version of
  // both "your prices are gone" and silence.
  const parkedTokenPrices = COST_PRICING_KINDS.filter(
    (kind) =>
      kind.reach !== 'per_call' && props.row?.kinds[kind.key].cost != null
  ).length

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='border-border/60 flex shrink-0 flex-col gap-2 border-b px-3 py-2.5'>
        <div className='flex items-center gap-2'>
          <FormField
            control={props.form.control}
            name={`cost_models.${props.index}.model`}
            render={({ field }) => (
              <FormItem className='min-w-0 flex-1'>
                <FormControl>
                  <Combobox
                    options={props.modelOptions}
                    value={field.value ?? ''}
                    onValueChange={field.onChange}
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
          {props.unservedModel && (
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
                <TriangleAlert className='size-4' aria-hidden='true' />
              </TooltipTrigger>
              <TooltipContent className='max-w-64'>
                {t(
                  'This channel does not request this model, so the buy price will never apply.'
                )}
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='text-muted-foreground hover:text-destructive size-8 shrink-0'
            aria-label={t('Remove model price')}
            onClick={props.onRemove}
          >
            <Trash2 className='size-4' aria-hidden='true' />
          </Button>
        </div>

        <div className='flex flex-wrap items-center justify-between gap-2'>
          {/* Per-request pricing excludes every per-token price, so it is a mode
              rather than a twelfth row that silently kills the eleven above it. */}
          <div
            role='group'
            aria-label={t('Billing mode')}
            className='bg-muted/60 flex shrink-0 gap-0.5 rounded-lg p-0.5'
          >
            {[
              { perCall: false, label: t('Per token') },
              { perCall: true, label: t('Per request') },
            ].map((mode) => (
              <Button
                key={String(mode.perCall)}
                type='button'
                size='sm'
                variant={
                  props.perCallMode === mode.perCall ? 'outline' : 'ghost'
                }
                aria-pressed={props.perCallMode === mode.perCall}
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs font-medium',
                  props.perCallMode === mode.perCall
                    ? 'bg-card shadow-xs'
                    : 'text-muted-foreground'
                )}
                onClick={() => props.onPerCallModeChange(mode.perCall)}
              >
                {mode.label}
              </Button>
            ))}
          </div>

          <ModelMarkupOverrideField
            form={props.form}
            index={props.index}
            channelMarkupPercent={props.channelMarkupPercent}
            inherits={props.row?.inheritsChannelMarkup ?? true}
            onReset={props.onResetMarkup}
          />
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-auto overscroll-contain px-3 py-2'>
        {props.perCallMode ? (
          <div className='flex flex-col gap-2'>
            <div className='border-border/60 bg-muted/25 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5'>
              <div className='min-w-0 flex-1'>
                <span className='text-xs font-medium'>
                  {t(KIND_TEXT.per_call.label)}
                </span>
                <p className='text-muted-foreground/80 text-[11px]'>
                  {t(KIND_TEXT.per_call.hint)}
                </p>
              </div>
              <BuyPriceInput
                form={props.form}
                index={props.index}
                kind='per_call'
                label={t('Buy price ({{kind}})', {
                  kind: t(KIND_TEXT.per_call.label),
                })}
                placeholder={KIND_TEXT.per_call.placeholder}
                className='w-24'
              />
              <div className='flex shrink-0 flex-col items-end leading-tight'>
                <DerivedValue
                  text={formatUsdPerMillion(perCallDimension?.sellPrice)}
                  muted={perCallDimension?.sellPrice == null}
                />
                <span className='text-muted-foreground/70 text-[10px]'>
                  {t('$ / request')}
                </span>
              </div>
            </div>
            {parkedTokenPrices > 0 && (
              <p className='text-muted-foreground text-[11px] leading-4'>
                {t(
                  '{{count}} per-token price(s) are kept but ignored while a per-request price is set.',
                  { count: parkedTokenPrices }
                )}
              </p>
            )}
          </div>
        ) : (
          <div className='flex flex-col gap-1'>
            <div
              className={cn(
                SHEET_GRID,
                'text-muted-foreground bg-card sticky top-0 z-10 px-2.5 pb-1 text-[11px] font-medium'
              )}
            >
              <span>{t('Dimension')}</span>
              <span className='text-right'>{t('Buy')}</span>
              <span className='text-right'>{t('Sell')}</span>
              <span className='hidden text-right sm:block'>
                {t('vs official')}
              </span>
            </div>

            {COST_PRICING_GROUPS.map((group) => (
              <div key={group.id} className='flex flex-col'>
                <span className='text-muted-foreground/70 px-2.5 pt-1.5 pb-0.5 text-[11px]'>
                  {t(group.label)}
                </span>
                {group.keys.map((kind) => (
                  <SheetRow
                    key={kind}
                    form={props.form}
                    index={props.index}
                    kind={kind}
                    row={props.row}
                    isLoadingOfficialPrice={props.isLoadingOfficialPrice}
                    renderDiscount={props.renderDiscount}
                  />
                ))}
              </div>
            ))}

            <p className='text-muted-foreground/75 px-2.5 pt-2 text-[11px] leading-4'>
              {t(
                'Margin on this model: {{margin}}. Blank dimensions are not charged.',
                { margin: formatMarginRate(props.row?.marginRate) }
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
