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
import { memo } from "react";
import { useTranslation } from "react-i18next";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDiscount } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { PriceComparison } from "../lib/price-comparison";

export interface PriceComparisonTableProps {
  comparison: PriceComparison;
  /** Rendered in the header of the platform price column, e.g. `平台价/M`. */
  unitLabel: string;
  /**
   * Rendered in the header of the official price column, e.g. `官方价/M`.
   * Not needed when {@link hideOfficialPrice} drops that column.
   */
  officialLabel?: string;
  className?: string;
  /**
   * Drop the outer card chrome for embedding inside another bordered card —
   * a boxed table inside a boxed card reads as a box in a box.
   */
  bare?: boolean;
  /**
   * Tighter rows for the narrow channel list, where several of these tables are
   * stacked in one scrolling column. At full padding the column runs so long
   * that the cards read as loose rather than as a list.
   */
  dense?: boolean;
  /**
   * Drop the official price column, keeping the discount pill. For the narrow
   * channel list, where the struck-through vendor rate is the widest column
   * carrying the least new information: the same model's official price repeats
   * down every card, and the detail pane the reader lands on after picking a
   * channel prints platform and official side by side anyway.
   *
   * The discount pill stays because it is the only per-channel number here that
   * is not already in the platform column, and gains a tooltip carrying the
   * vendor rate it was measured against.
   */
  hideOfficialPrice?: boolean;
}

const DISCOUNT_PILL_CLASS =
  "inline-flex items-center rounded-md bg-orange-500/12 px-2 py-0.5 text-[13px] font-semibold text-orange-600 tabular-nums dark:bg-orange-400/15 dark:text-orange-400";

/**
 * The discount badge, optionally naming the price it is measured against.
 *
 * `official` is passed only where the official price column was dropped: there
 * the pill is the reader's one remaining route to the vendor rate, so it becomes
 * hoverable. Where the column is present the number is already on screen and a
 * tooltip repeating it would be noise, so the pill stays inert.
 */
function DiscountPill(props: { text: string; official?: string }) {
  const { t } = useTranslation();

  if (props.official == null) {
    return <span className={DISCOUNT_PILL_CLASS}>{props.text}</span>;
  }

  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              // Dotted underline is the whole affordance: without it the pill
              // looks identical to the inert one and nobody thinks to hover.
              // Not a tab stop — these tables sit inside cards that are
              // themselves the interactive element, and ARIA forbids focusable
              // descendants of a button. The row reads fine to AT without it:
              // the official price is a redundant restatement of the discount.
              className={cn(
                DISCOUNT_PILL_CLASS,
                "cursor-help decoration-orange-600/35 underline-offset-2 hover:underline hover:decoration-dotted dark:decoration-orange-400/35",
              )}
            />
          }
        >
          {props.text}
        </TooltipTrigger>
        {/* No arrow: the pill is a ~30px target in a stack of cards, and the
            arrow lands on the row above it looking like a stray mark. Sits a
            little further off the trigger to stay legible without one, and
            carries roomier padding — one short line in a tight box reads as
            cramped. */}
        <TooltipContent
          side="top"
          sideOffset={6}
          showArrow={false}
          className="gap-2 px-3 py-2"
        >
          <span className="text-background/70">{t("Official price")}</span>
          <span className="font-mono font-semibold tabular-nums">
            {props.official}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Compact price breakdown: what the customer pays, what the vendor charges, and
 * the discount between them.
 *
 * When no row has a known official price (`hasOfficialPrice === false`) the
 * official and discount columns are dropped rather than filled with
 * placeholders — a two-column table reads as "this is the price", which is the
 * truth for a model the official-price sync has never seen. Rows that
 * individually lack an official rate still show `-`, because the columns are
 * meaningful for their neighbours.
 *
 * `hideOfficialPrice` drops only the official column, for callers too narrow to
 * afford it; see that prop.
 */
export const PriceComparisonTable = memo(function PriceComparisonTable(
  props: PriceComparisonTableProps,
) {
  const { t } = useTranslation();
  const { comparison } = props;

  if (comparison.specialExpression) {
    return (
      <div
        className={cn(
          "rounded-lg border border-amber-200/70 bg-amber-50/60 px-2.5 py-2 dark:border-amber-500/20 dark:bg-amber-500/10",
          props.className,
        )}
      >
        <div className="text-xs font-medium text-amber-800 dark:text-amber-200">
          {t("Special billing expression")}
        </div>
        <code className="text-muted-foreground/70 mt-0.5 line-clamp-1 block font-mono text-xs break-all">
          {comparison.specialExpression}
        </code>
      </div>
    );
  }

  if (comparison.rows.length === 0) {
    return null;
  }

  // Two independent questions: is there a vendor price to compare against at
  // all, and does this caller have room to print it. The discount column
  // survives the second one alone.
  const showDiscount = comparison.hasOfficialPrice;
  const showOfficial = showDiscount && !props.hideOfficialPrice;

  // A real <table>, not a grid per row: the header and the body have to share
  // one set of column widths. As separate grids the label column sized itself
  // twice — once against `Price item`, once against the shorter `Input` — so
  // every column after it started at a different x in the header than in the
  // rows, and no value sat under its own heading.
  //
  // Money columns are right-aligned, which lands each value's last digit on the
  // same edge as the right end of its heading. The label column is pinned to
  // `w-0`, the auto-layout way of asking for min-content.
  //
  // Where the leftover width goes is the whole difference between these reading
  // tight and reading loose, and the label column is the one place it must not
  // go: the labels are left-aligned and the prices right-aligned, so width
  // parked there becomes a gap between a label and its own price. Hence `w-0`
  // on the label in both modes — an even split across all columns looks
  // balanced described in the abstract and reads as a hole in practice.
  //
  // The wide table has ~190px to place across 450px. Capping the two money
  // columns pulls the price block left off the labels and leaves the rest around
  // the pill, where a gap costs nothing. The narrow one has no slack to move:
  // its gap is right-alignment against a six-decimal ¥0.948999, and only a
  // smaller number or a smaller font shrinks that.
  const cellY = props.dense ? "py-1.5" : "py-2.5";
  const moneyW = props.dense ? "" : "w-[26%]";
  const officialW = props.dense ? "" : "w-[24%]";
  const discountX = "pr-3 pl-2 text-center";
  // Only meaningful for the platform column, which is last when there is
  // nothing to compare against and has to carry the table's right padding.
  // `pl-1`, not `pl-2`: this is the left edge of the gap being complained about,
  // and the label's own `pr-1` is the right edge. 8px off a gap is small on its
  // own but it is the only part of it that is pure padding.
  const platformX = showDiscount ? "pr-2 pl-1" : "pr-3 pl-1";

  return (
    <div
      className={cn(
        // Border, header fill and row rules are all kept deliberately faint:
        // at this size three full-strength lines turn every cell into a walled
        // box. They only need to hint at the grid, not draw it. Bare mode drops
        // the wall entirely — the host card already drew it.
        props.bare
          ? "overflow-hidden rounded-lg"
          : "border-border/50 overflow-hidden rounded-lg border",
        props.className,
      )}
    >
      <table className="w-full table-auto border-collapse">
        <thead className="bg-muted/35 text-muted-foreground/70 text-xs font-medium">
          <tr>
            <th
              scope="col"
              className={cn(
                "w-0 pr-1 pl-3 text-left font-medium whitespace-nowrap",
                cellY,
              )}
            >
              {t("Price item")}
            </th>
            <th
              scope="col"
              className={cn("text-right font-medium", moneyW, platformX, cellY)}
            >
              {props.unitLabel}
            </th>
            {showOfficial && (
              <th
                scope="col"
                className={cn("px-2 text-right font-medium", officialW, cellY)}
              >
                {props.officialLabel}
              </th>
            )}
            {showDiscount && (
              <th scope="col" className={cn("font-medium", discountX, cellY)}>
                {t("Discount")}
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {comparison.rows.map((row, index) => {
            // Both the pill and the strikethrough hang off this one value, so the
            // two can never disagree about whether a saving exists. It is also
            // the last line of defence for the discount claim: `formatDiscount`
            // refuses a ratio at or above 1, which covers a row that reached this
            // table with the platform price above the vendor's. Those rows keep
            // the `-`, and the neighbouring note about channels pricing cached
            // reads above the direct rate carries the fact instead. A pill is the
            // wrong place for it — on a page every visitor can see, "22.6折" is
            // nonsense and "-126% off" is a self-inflicted wound.
            const discountText =
              row.discountRatio == null
                ? null
                : formatDiscount(row.discountRatio, t);

            return (
              <tr
                key={row.key}
                className={index > 0 ? "border-border/30 border-t" : undefined}
              >
                <th
                  scope="row"
                  className={cn(
                    "text-foreground w-0 pr-1 pl-3 text-left text-[13px] font-bold whitespace-nowrap",
                    cellY,
                  )}
                >
                  {t(row.labelKey)}
                </th>
                {/* The price the customer actually pays is the card's visual
                  anchor, so it carries the accent colour and the most weight. */}
                <td
                  className={cn(
                    "text-right font-mono text-[15px] font-bold text-rose-600 tabular-nums dark:text-rose-400",
                    platformX,
                    cellY,
                  )}
                >
                  {row.platform}
                </td>
                {/* Struck through only when the platform price actually beats
                  it. A strikethrough on a price we do not undercut would claim
                  a saving that is not there. */}
                {showOfficial && (
                  <td
                    className={cn(
                      "text-muted-foreground/45 px-2 text-right font-mono text-[13px] tabular-nums",
                      discountText != null && "line-through",
                      cellY,
                    )}
                  >
                    {row.official}
                  </td>
                )}
                {showDiscount && (
                  <td className={cn(discountX, cellY)}>
                    {discountText == null ? (
                      <span className="text-muted-foreground/45 font-mono text-[13px]">
                        -
                      </span>
                    ) : (
                      <DiscountPill
                        text={discountText}
                        official={
                          props.hideOfficialPrice ? row.official : undefined
                        }
                      />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
