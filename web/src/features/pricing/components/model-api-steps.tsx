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
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

// Shared scaffolding for the numbered "how to call this model" steps. Lives in
// its own module so the API-key step can reuse it without importing the panel
// that renders it.

/**
 * One numbered step.
 *
 * The number is the whole point of the redesign: the previous panel listed a
 * base URL, six endpoints and an auth header as one flat stack of equals, and a
 * reader had no way to tell that they needed exactly three of those things in
 * one specific order. Numbering them says "do these, in this order, and you are
 * done".
 */
export function StepCard(props: {
  index: number
  title: string
  hint?: string
  icon?: LucideIcon
  trailing?: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const Icon = props.icon

  return (
    // A segment of the enclosing panel, not a card of its own. Three nested
    // cards inside one card was the thing that read as fragments: the hairline
    // above each step does the separating, and the step's own surface stays the
    // panel's, so the whole block is one object.
    <section className='border-border/60 px-4 py-3.5 not-first:border-t'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          {/* A filled gradient pill carrying icon + ordinal, not a hollow
              circle with a digit. The number has to survive being read at a
              glance across a 50vw drawer, and a tinted outline does not. */}
          <span
            className='from-primary inline-flex shrink-0 items-center gap-1 rounded-full bg-linear-to-br to-[oklch(0.62_0.17_262)] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm'
            aria-hidden
          >
            {Icon && <Icon className='size-3' />}
            {t('Step')} {props.index}
          </span>
          {/* The pill is decorative, so the ordinal is announced here instead —
              a narrow drawer has no room to print it twice. */}
          <span className='sr-only'>
            {t('Step')} {props.index}:{' '}
          </span>
          <h3 className='truncate text-[13.5px] font-semibold tracking-tight'>
            {props.title}
          </h3>
        </div>
        {props.trailing}
      </div>
      {props.hint && (
        <p className='text-muted-foreground mt-1.5 text-xs leading-relaxed'>
          {props.hint}
        </p>
      )}
      <div className='mt-2.5 space-y-2'>{props.children}</div>
    </section>
  )
}

/**
 * A label, a copyable monospace value, and an optional usage disclosure.
 *
 * `copyValue` exists for the API key row: what the reader sees is a mask, and
 * what the clipboard gets is the real key, fetched only when they ask for it.
 */
export function CopyableRow(props: {
  label: React.ReactNode
  value: string
  copyValue?: string
  method?: string
  trailingLabel?: React.ReactNode
  usageKey?: string
  dotted?: boolean
  /**
   * Distinguishes this row's copy button from the others in the panel. Four rows
   * can be on screen at once, and "Copy" four times over gives a screen-reader
   * user no way to tell which value they are about to take.
   */
  copyLabel?: string
  /** Replaces the copy button entirely — used by the async key fetch. */
  action?: React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    // An inset surface per value, not a table row between hairlines. The panel
    // used to divide rows with `divide-y`, which reads as a spreadsheet; giving
    // each value its own tinted panel inside the card makes the copyable thing
    // look like the object it is.
    <div className='bg-primary/[0.045] ring-primary/12 hover:ring-primary/30 rounded-xl px-3 py-2.5 ring-1 transition-colors'>
      <div className='flex items-center justify-between gap-2'>
        <span className='flex min-w-0 items-center gap-1.5'>
          {props.dotted && (
            <span
              className='bg-primary ring-primary/20 size-1.5 shrink-0 rounded-full ring-2'
              aria-hidden
            />
          )}
          {/* No `uppercase tracking-wider` here: CJK has no case, so the old
              styling only spread the glyphs apart and shrank them. */}
          <span className='text-muted-foreground min-w-0 truncate text-xs font-medium'>
            {props.label}
          </span>
        </span>
        <span className='flex shrink-0 items-center gap-1.5'>
          {props.trailingLabel}
          {props.method && (
            <span className='rounded bg-emerald-500/12 px-1.5 py-px font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400'>
              {props.method}
            </span>
          )}
        </span>
      </div>
      <div className='mt-1.5 flex items-center gap-2'>
        {/* Wraps rather than truncates: this is the one string on the page a
            reader needs in full, and the old narrow sidebar clipped every URL
            past the host. `break-all` because paths have no spaces to break on. */}
        <code className='text-foreground min-w-0 flex-1 font-mono text-[13px] leading-relaxed font-semibold break-all'>
          {props.value}
        </code>
        {props.action ?? (
          // Tinted blue rather than a neutral outline: copying is the only thing
          // a reader does in this panel, so it should look like the action.
          <CopyButton
            value={props.copyValue ?? props.value}
            variant='ghost'
            size='sm'
            className='bg-primary/10 text-primary hover:bg-primary/18 hover:text-primary h-7 shrink-0 gap-1 px-2.5 text-[11px] font-semibold'
            iconClassName='size-3'
            aria-label={props.copyLabel ?? t('Copy')}
            notify
          >
            {t('Copy')}
          </CopyButton>
        )}
      </div>
      {props.usageKey && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className='text-muted-foreground hover:text-primary mt-1.5 -ml-0.5 inline-flex items-center gap-0.5 text-[11px] transition-colors'>
            <ChevronRight
              className={cn('size-3 transition-transform', open && 'rotate-90')}
              aria-hidden
            />
            {t('What this is for')}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className='text-muted-foreground border-primary/30 mt-1 border-l-2 pl-2 text-[11px] leading-relaxed'>
              {t(props.usageKey)}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
