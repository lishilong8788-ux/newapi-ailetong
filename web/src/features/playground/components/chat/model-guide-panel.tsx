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
import { TriangleAlertIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { getLobeIcon } from '@/lib/lobe-icon'

import { getCapability, type BillingSpec } from '../../lib/capability'
import {
  MODALITY_LABELS,
  MODALITY_VARIANTS,
} from '../../lib/model-library/filters'
import type { ModelOption } from '../../types'

/** Billing unit to the phrase shown under the model name (i18next keys). */
const BILLING_UNIT_LABELS: Record<BillingSpec['unit'], string> = {
  token: 'Billed per token',
  call: 'Billed per request',
  second: 'Billed per second',
  char: 'Billed per character',
}

type ModelGuidePanelProps = {
  model: ModelOption
}

/**
 * The main-area empty state once a model is selected: the model's mark, its
 * name, how it bills, and what an operator wrote about it.
 *
 * Deliberately sparse, and it took two passes to get here. It first listed the
 * modality's strengths and caveats in two columns, which read as a spec sheet in
 * front of an empty composer. It then still offered four starter prompts drawn
 * from the modality — but those are the same four for every chat model in the
 * deployment, so a maths-tuned checkpoint was inviting people to "review code".
 * A suggestion that does not know which model it is attached to is worse than no
 * suggestion, so the panel now answers "what did I just pick" and nothing else.
 *
 * The modality copy (`strengths` / `caveats` / `examples` on the guide) is still
 * in `model-guide.ts` for a surface that can scope it properly.
 *
 * Centred rather than left-aligned: there is not enough here to anchor a left
 * edge, and the composer below is centred too.
 */
export function ModelGuidePanel({ model }: ModelGuidePanelProps) {
  const { t } = useTranslation()
  const capability = model.modality ? getCapability(model.modality) : undefined
  const isUnavailable = capability !== undefined && !capability.available

  /**
   * Only this model's own description, never a stand-in.
   *
   * This is the description an operator typed on the model itself (Models →
   * edit), carried here by `/api/pricing`. An earlier version fell back to the
   * modality's `guide.tagline` when it was blank, which put "Conversational model
   * for text reasoning, writing and code." under every chat model — including
   * ones it actively misdescribes, like a maths-tuned checkpoint. A sentence that
   * is generically true of the modality reads as a statement about *this* model
   * and is therefore worse than admitting nothing was written.
   *
   * Some deployments fill the field with the model name; that carries no
   * information either, so it counts as blank.
   */
  const description =
    model.description && model.description !== model.label
      ? model.description
      : undefined

  return (
    // `items-start` with a viewport-proportional top inset, not `items-center`.
    // Centring inside a 520px box put the mark near the middle of the free space
    // and pushed the description toward the composer, so the group read as
    // sagging into the bottom of the page with nothing holding it up. Optical
    // centring wants a block like this high — anchored in the upper third, with
    // the remaining space falling below it.
    <div className='flex min-h-[min(520px,calc(100svh-18rem))] items-start justify-center px-1 pt-[clamp(1.5rem,7vh,4.5rem)] pb-8'>
      {/* Flat on purpose: the entrance stagger in `index.css` keys off direct
          children, so the mark, the name, the meta line and the description each
          have to be one. */}
      <div className='playground-guide-animate grid w-full max-w-xl justify-items-center'>
        {/* `text-warning` on a tint, not `text-warning-foreground`: that token is
            near-black by design because it pairs with a *solid* warning fill, and
            on this 10% tint it goes unreadable in dark mode. Body copy stays on
            `foreground` so the notice itself always passes. */}
        {/* Sized to its content, not to the column.

            It was `w-full`, which stretched the box to the full 576px while the
            text only ever filled about 450px of it. Left-aligned content in a
            box far wider than itself is the specific thing that reads as
            "cramped on the left, empty on the right" — the padding was
            symmetrical, but the *content* was not, so the eye measured 12px on
            one side against 80px on the other. Shrinking to fit gives it one
            even margin on both sides.

            `max-w-full` keeps that from becoming a new problem in languages
            where this string is long: it shrink-wraps short copy and wraps
            instead of overflowing when the copy is long. */}
        {isUnavailable ? (
          <div
            className='border-warning/40 bg-warning/10 mb-9 inline-flex max-w-full items-start gap-2.5 rounded-xl border py-3 pr-4 pl-3.5'
            role='status'
          >
            <TriangleAlertIcon
              className='text-warning mt-[3px] size-4 shrink-0'
              aria-hidden='true'
            />
            {/* The body no longer restates the title. It read "尚未开放 · 该能力
                尚未开放，当前可以…" — the first clause of the sentence was the
                heading again, which is what made the line feel padded out to
                fill space it did not need. */}
            <div className='text-foreground/90 min-w-0 text-left text-[13px] leading-relaxed'>
              <span className='font-semibold'>{t('Not open yet')}</span>
              <span className='mx-1.5 opacity-40'>·</span>
              <span>
                {t('You can browse the model, but requests cannot be sent.')}
              </span>
            </div>
          </div>
        ) : null}

        {/* The mark is the anchor of this layout, so it is given real size rather
            than the list card's 36px frame — and more of it than before, because
            at 56px it was competing with the model name instead of leading it.
            Unframed, unlike the model library card: there it sits in a column of
            other logos and needs an edge to line up against, here it stands alone.

            The halo behind it is what stops a flat vector mark from looking
            pasted onto the page. It is a blurred tint of the mark's own footprint
            rather than a drop shadow, so it reads as the logo lighting the
            surface instead of floating above it. */}
        {/* `mb-3.5`, down from `mb-6`. The mark's glyph does not fill its 72px box
            — there is built-in transparent padding around a Lobe logo — so 24px of
            margin measured more like 31px of visible gap, and the mark stopped
            reading as belonging to the name under it. Proximity is what groups
            these two; the space below the pair is what separates the group from
            the rest. */}
        <div className='playground-guide-mark relative mb-3.5 flex size-[72px] items-center justify-center'>
          <span
            aria-hidden='true'
            className='bg-primary/12 dark:bg-primary/20 absolute inset-2 rounded-full blur-2xl'
          />
          {model.icon ? (
            <span className='relative'>{getLobeIcon(model.icon, 64)}</span>
          ) : (
            <span className='bg-muted/60 text-muted-foreground relative flex size-[72px] items-center justify-center rounded-[22px] text-[26px] font-bold'>
              {model.label.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        {/* Identity: who this is. The name, and under it who makes it. */}
        <div className='mb-5 max-w-full text-center'>
          {/* The name owns its row, with nothing beside it.

              It used to share a centred flex row with the modality badge. That
              centres *name + badge* as a unit, which silently pushes the name
              itself off-axis by half the badge's width — about 20px, enough that
              it no longer lined up with the mark above it and read as crooked
              without it being obvious why. Short names skew worst, since the
              offset is a larger share of their width. The badge is now a chip in
              the row below, where it costs the name nothing.

              Wraps rather than truncates: model IDs here are routinely
              path-shaped (`@cf/deepseek-ai/deepseek-math-7b-instruct`) and
              `truncate` cut them at the one place a name stops being
              identifiable. `text-balance` keeps a wrapped name from leaving a
              single orphaned word on the second line. */}
          <h2
            className='text-foreground max-w-full text-[22px] leading-tight font-semibold tracking-[-0.01em] text-balance break-words'
            title={model.label}
          >
            {model.label}
          </h2>

          {/* The vendor belongs to the name, not to the chip row.

              It was a third chip beside the modality and the billing unit, which
              was a category error on my part: those two describe what the model
              *does* and what it *costs*, while the vendor is part of who it *is*.
              Presenting all three as peers invited the eye to compare values on
              three unrelated axes, which is why the row did not hold together.

              It also carried a 14px copy of the vendor logo sitting 30px under
              the 64px mark of the same glyph. As a subtitle it needs no logo at
              all — the mark above is already the vendor mark — and this is the
              same name-over-vendor stack the library cards on the left use, so
              picking a model no longer rearranges the same facts.

              `mt-1.5` rather than the row's old `gap-3`: subordinate lines sit
              close to what they qualify. */}
          {model.vendorName ? (
            <p className='text-muted-foreground mt-1.5 text-[13px] leading-snug'>
              {model.vendorName}
            </p>
          ) : null}
        </div>

        {/* Attributes: two facts on the same axis — what it does, what it costs.
            Both are properties of the model measured against the deployment, both
            are things a user checks before spending on a request, and both are
            short enough to read as values rather than sentences.

            The modality keeps its semantic colour because it is a category the
            library filters by; billing gets a neutral outline, so the pair reads
            as one primary and one secondary rather than two competing claims. */}
        <div className='mb-8 flex max-w-full flex-wrap items-center justify-center gap-1.5'>
          {model.modality ? (
            <StatusBadge
              label={t(MODALITY_LABELS[model.modality])}
              variant={MODALITY_VARIANTS[model.modality]}
              filled
              copyable={false}
              className='h-[22px] shrink-0 px-2 text-[11.5px]'
            />
          ) : null}
          {capability ? (
            <span className='border-border bg-muted/40 text-muted-foreground inline-flex h-[22px] shrink-0 items-center rounded-md border px-2 text-[11.5px] leading-none'>
              {t(BILLING_UNIT_LABELS[capability.billing.unit])}
              {capability.billing.note
                ? ` (${t(capability.billing.note)})`
                : ''}
            </span>
          ) : null}
        </div>

        {/* Written and unwritten are not the same kind of thing, so they no longer
            get the same treatment.

            A real description needs a surface: operator copy runs from one line to
            a full paragraph, and the card gives every length the same shape. An
            absence needs no container at all. Boxing it produced the "似有似无"
            problem twice over — first as a hairline nobody could see, then, once I
            raised the contrast, as a visible dashed frame drawing attention to the
            fact that there was nothing inside it. The border was never the bug;
            framing an absence was.

            `min-h` on the slot keeps most of the anti-jump benefit the shared box
            was there for, without asserting a boundary around empty space. */}
        <div className='flex min-h-[92px] w-full items-start justify-center'>
          {description ? (
            // Left-aligned, 14px, and loose-leaded. It was 13px centred, which is
            // why it read as a caption the eye skips: centred prose has a ragged
            // left edge, so every line starts somewhere new and there is nothing to
            // scan down. Real descriptions here run to several sentences, and past
            // about two lines centring stops being a style and starts being a cost.
            // The card is what centres this block on the page; the text inside it
            // does not need to repeat that.
            //
            // Full-strength `border-border` over a full-strength `bg-muted`, not
            // the `/60` and `/30` these were. Composited over white, that pair
            // came out as a 4% step on the border and under 1% on the fill — a
            // panel the eye can detect but cannot resolve, which is more tiring to
            // read than either a plain paragraph or a frank one. The fill is doing
            // most of the work now: `--muted` sits ~3% under card white, the same
            // depth the theme already uses to separate canvas from card, so this
            // reads as one recessed surface rather than a line someone drew. No
            // shadow — a shadow would claim it is raised, and it is not.
            //
            // `px-6 py-5`, up from `px-5 py-4`. 14px copy at 1.75 leading carries
            // ~5px of half-leading inside its line box, so 20px of vertical
            // padding measures like ~24px against the 24px sides — square once
            // the text is accounted for, where the old 16px read as clipped.
            <p className='border-border bg-muted text-foreground/80 w-full rounded-2xl border px-6 py-5 text-left text-sm leading-[1.75] tracking-[0.003em]'>
              {description}
            </p>
          ) : (
            // No border, no fill, no box — just a quiet line. Centred, since it is
            // one short phrase rather than prose, and dimmer than body copy because
            // it is a note about the page rather than content on it.
            <p className='text-muted-foreground/75 px-5 pt-1 text-center text-[13px] leading-relaxed'>
              {/* Shares the pricing page's string for the same situation
                  (`model-details-header.tsx`) rather than adding a near-duplicate
                  key — one deployment-wide phrasing for "nobody filled this in". */}
              {t('No description has been added for this model yet.')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
