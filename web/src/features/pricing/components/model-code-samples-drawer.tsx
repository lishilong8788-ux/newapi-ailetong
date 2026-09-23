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
import { Code2, Route } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { sideDrawerContentClassName } from '@/components/drawer-layout'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { getClientModelName } from '../lib/channel-price'
import type { ChannelRoute, PricingModel } from '../types'
import { ModelDetailsApi } from './model-details-api'

export interface ModelCodeSamplesDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: PricingModel
  endpointMap: Record<string, { path?: string; method?: string }>
  /** Every line on the model, for the line picker. Empty is fine. */
  routes?: ChannelRoute[]
  /**
   * The line the reader opened this from, so the samples land on the same line
   * the pane behind them was showing. Undefined means automatic routing, where
   * the callable string is the bare model name.
   */
  lineCode?: string
}

/**
 * The code samples, over the panel that sent the reader here.
 *
 * A second drawer rather than a tab on the first: the samples are a reference a
 * reader consults *while* comparing prices, and a tab replaces what they were
 * reading. Closing this one returns them to the price pane with its channel
 * selection and scroll position intact, because it never unmounted — Base UI's
 * dialog nests natively, so Escape and the backdrop only take the top panel.
 *
 * Narrower than the details drawer on purpose. The sliver of the panel left
 * showing on the left is what says "this is on top of that" rather than "this
 * replaced that", and code samples do not need the width a two-column price
 * comparison does.
 */
export function ModelCodeSamplesDrawer(props: ModelCodeSamplesDrawerProps) {
  const { t } = useTranslation()

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side='right'
        className={sideDrawerContentClassName(
          cn(
            'sm:max-w-2xl md:max-w-3xl lg:max-w-[min(42vw,52rem)]',
            'border-l-0',
            '[&>[data-slot=sheet-close]]:text-white/80 [&>[data-slot=sheet-close]]:hover:bg-white/15 [&>[data-slot=sheet-close]]:hover:text-white'
          )
        )}
      >
        <SheetHeader className='sr-only'>
          <SheetTitle>{t('API Documentation')}</SheetTitle>
          <SheetDescription>{props.model.model_name}</SheetDescription>
        </SheetHeader>
        {/* The panel body is its own component so that its line selection is
            born from `lineCode` on every open: the portal unmounts on close, so
            the state goes with it and a reader who opens the samples from a
            different channel does not inherit the previous line. */}
        <CodeSamplesPanel
          model={props.model}
          endpointMap={props.endpointMap}
          routes={props.routes ?? []}
          lineCode={props.lineCode}
        />
      </SheetContent>
    </Sheet>
  )
}

function CodeSamplesPanel(props: {
  model: PricingModel
  endpointMap: Record<string, { path?: string; method?: string }>
  routes: ChannelRoute[]
  lineCode?: string
}) {
  const { t } = useTranslation()
  const [lineCode, setLineCode] = useState(props.lineCode ?? '')

  const modelName = props.model.model_name || ''
  const clientModelName = getClientModelName(modelName, lineCode || undefined)

  // Only lines with a code can be named in a request at all. A channel the
  // operator left unnamed is reachable by automatic routing alone, so listing it
  // here would offer a string that does not exist.
  const codes = [
    ...new Set(
      props.routes
        .map((route) => route.code)
        .filter((code): code is string => Boolean(code))
    ),
  ]

  return (
    <>
      {/* Same band as the details drawer, one line tall: the two panels are the
          same object seen at two depths, and a white header on top of a
          coloured one would read as a different screen. */}
      <header className='from-band-start to-band-end relative shrink-0 bg-linear-to-br px-4 py-2.5 pr-13 text-white sm:px-6 sm:pr-14'>
        <div className='relative flex min-w-0 items-center gap-2.5'>
          <span className='flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30'>
            <Code2 className='size-4' aria-hidden />
          </span>
          <div className='min-w-0'>
            {/* Named for the card the reader came from, not for the first section
                inside: "Code samples" appears again as that section's own
                heading, and a panel whose title repeats its first heading reads
                as one thing printed twice. */}
            <h2 className='truncate text-[15px] font-semibold tracking-tight'>
              {t('API Documentation')}
            </h2>
            <div className='flex min-w-0 items-center gap-1'>
              <span className='truncate font-mono text-xs text-white/80'>
                {clientModelName}
              </span>
              <CopyButton
                value={clientModelName}
                className='size-5 shrink-0 text-white/70 hover:bg-white/15 hover:text-white'
                iconClassName='size-3'
                tooltip={t('Copy model name')}
                successTooltip={t('Copied!')}
                aria-label={t('Copy model name')}
              />
            </div>
          </div>
        </div>
      </header>

      <div className='bg-surface-sunken no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6'>
        {codes.length > 0 && (
          <LinePicker
            codes={codes}
            selected={lineCode}
            onSelect={setLineCode}
            modelName={modelName}
          />
        )}
        <ModelDetailsApi
          model={props.model}
          endpointMap={props.endpointMap}
          clientModelName={clientModelName}
        />
      </div>
    </>
  )
}

/**
 * Which line the samples are written for.
 *
 * The samples differ by one string — the `model` field — so this is a switch over
 * that string rather than a navigation control. Automatic routing leads because
 * it is the default every reader should use unless they have a reason not to:
 * naming a line is a preference the router honours when it can and abandons when
 * that line is down, so the bare name is the one that never needs revisiting.
 */
function LinePicker(props: {
  codes: string[]
  selected: string
  onSelect: (code: string) => void
  modelName: string
}) {
  const { t } = useTranslation()

  return (
    <section className='bg-card border-border/70 shadow-raised rounded-xl border p-3'>
      <h3 className='text-foreground mb-1.5 flex items-center gap-1.5 text-sm font-semibold'>
        <Route className='text-muted-foreground/70 size-3.5' aria-hidden />
        {t('Line')}
      </h3>
      <p className='text-muted-foreground mb-2.5 text-xs leading-relaxed'>
        {t(
          'The samples below change with this: naming a line appends its code to the model name. The request still falls back to another channel when that line is unavailable.'
        )}
      </p>
      <div className='flex flex-wrap gap-1.5'>
        <LineChip
          label={t('Automatic routing')}
          value={props.modelName}
          selected={props.selected === ''}
          onSelect={() => props.onSelect('')}
        />
        {props.codes.map((code) => (
          <LineChip
            key={code}
            label={code}
            value={`${props.modelName}/${code}`}
            selected={props.selected === code}
            onSelect={() => props.onSelect(code)}
          />
        ))}
      </div>
    </section>
  )
}

function LineChip(props: {
  label: string
  value: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type='button'
      onClick={props.onSelect}
      aria-pressed={props.selected}
      // The chip prints the string it selects, not just the code: the whole
      // point of the control is which `model` value the reader ends up copying,
      // and a bare `hs10` does not show that.
      className={cn(
        'focus-visible:ring-ring rounded-lg border px-2.5 py-1 font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none',
        props.selected
          ? 'border-primary bg-primary/10 text-primary font-semibold'
          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
      )}
    >
      <span className='mr-1.5 font-sans text-[11px] opacity-70'>
        {props.label}
      </span>
      {props.value}
    </button>
  )
}
