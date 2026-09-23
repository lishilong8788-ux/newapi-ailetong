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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { PriceComparisonTable } from "../components/price-comparison-table";
import {
  getPriceComparison,
  type PriceComparison,
  type PriceComparisonRow,
} from "../lib/price-comparison";
import type { PricingModel } from "../types";

// These tests cover the wiring between the comparison data and the rendered
// table — column count, which cell gets the strikethrough, where `-` lands. The
// lib-level tests verify the numbers; nothing there would catch a swapped prop or
// a header that outlives its column.

function buildModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: "test-model",
    quota_type: 0,
    model_ratio: 0.96,
    completion_ratio: 5,
    enable_groups: ["default"],
    group_ratio: { default: 1 },
    ...overrides,
  };
}

function renderTable(model: PricingModel) {
  const comparison = getPriceComparison(model, { tokenUnit: "M" });
  render(
    <PriceComparisonTable
      comparison={comparison}
      unitLabel="平台价/M"
      officialLabel="官方价/M"
    />,
  );
  return comparison;
}

/**
 * Render straight from hand-built rows, bypassing `getPriceComparison`.
 *
 * `calcDiscountRatio` never emits a ratio at or above 1, so going through a model
 * cannot reach the table's own handling of one. The table is a shared component
 * with an exported prop type, and the ratios it is handed come from two builders
 * plus whatever a future caller writes, so the ratio arrives as untrusted input
 * and is tested as such.
 */
function renderRows(rows: PriceComparisonRow[]) {
  const comparison: PriceComparison = {
    rows,
    ratio: 1,
    hasDiscount: false,
    hasOfficialPrice: true,
    officialDiscountRatio: null,
    isPerRequest: false,
  };
  render(
    <PriceComparisonTable
      comparison={comparison}
      unitLabel="平台价/M"
      officialLabel="官方价/M"
    />,
  );
}

/**
 * The open tooltip popup, or null.
 *
 * Base UI portals the popup and marks it with `data-slot`, without a `tooltip`
 * role, so there is no role query to reach it by.
 */
function tooltipContent() {
  return document.querySelector('[data-slot="tooltip-content"]');
}

/** The data row for a price type, found via its label cell. */
function rowFor(label: string) {
  const cell = screen.getByRole("rowheader", { name: label });
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

describe("PriceComparisonTable official price columns", () => {
  test("renders platform, official and discount columns when a comparison exists", () => {
    renderTable(
      buildModel({
        official_model_ratio: 7.5,
        official_completion_ratio: 5,
      }),
    );

    expect(
      screen.getByRole("columnheader", { name: "平台价/M" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "官方价/M" }),
    ).toBeInTheDocument();

    const input = rowFor("Input");
    const cells = within(input).getAllByRole("cell");
    // platform, official, discount — the label is a rowheader, not a cell.
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveTextContent("$1.92");
    expect(cells[1]).toHaveTextContent("$15");
    // The test env runs the English catalog, where the 0.13 ratio reads as its
    // complement. Under `zh` the same value renders "1.3折" via the
    // `{{tenths}}` form of this key.
    expect(cells[2]).toHaveTextContent("87% off");
  });

  test("strikes through the official price only where a discount is claimed", () => {
    renderTable(
      buildModel({
        // Input undercuts official; output is priced at parity with it.
        model_ratio: 0.96,
        completion_ratio: 15.625,
        official_model_ratio: 7.5,
        official_completion_ratio: 2,
      }),
    );

    const inputOfficial = within(rowFor("Input")).getAllByRole("cell")[1];
    const outputOfficial = within(rowFor("Output")).getAllByRole("cell")[1];

    expect(inputOfficial.className).toContain("line-through");
    // No discount on this row, so no strikethrough: striking a price we do not
    // undercut would claim a saving that is not there.
    expect(outputOfficial.className).not.toContain("line-through");
    expect(within(rowFor("Output")).getAllByRole("cell")[2]).toHaveTextContent(
      "-",
    );
  });

  test("drops both columns when no row has an official price", () => {
    renderTable(buildModel());

    expect(
      screen.getByRole("columnheader", { name: "平台价/M" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "官方价/M" }),
    ).not.toBeInTheDocument();

    // Platform only — a two-column table reads as "this is the price".
    expect(within(rowFor("Input")).getAllByRole("cell")).toHaveLength(1);
  });

  test("keeps the columns but shows dashes for a row the vendor never priced", () => {
    renderTable(
      buildModel({
        cache_ratio: 0.1,
        official_model_ratio: 7.5,
        // No official completion/cache ratio published.
      }),
    );

    expect(
      screen.getByRole("columnheader", { name: "官方价/M" }),
    ).toBeInTheDocument();
    expect(within(rowFor("Input")).getAllByRole("cell")[1]).toHaveTextContent(
      "$15",
    );

    for (const label of ["Output", "Cached"]) {
      const cells = within(rowFor(label)).getAllByRole("cell");
      expect(cells[1]).toHaveTextContent("-");
      expect(cells[2]).toHaveTextContent("-");
    }
  });
});

describe("PriceComparisonTable hideOfficialPrice", () => {
  // The narrow channel list drops the vendor column but keeps the discount. The
  // two used to be one flag, so this pins that they are now independent.
  test("drops the official column and keeps the discount pill", () => {
    const comparison = getPriceComparison(
      buildModel({ official_model_ratio: 7.5, official_completion_ratio: 5 }),
      { tokenUnit: "M" },
    );
    render(
      <PriceComparisonTable
        comparison={comparison}
        unitLabel="渠道价/M"
        hideOfficialPrice
      />,
    );

    expect(
      screen.getByRole("columnheader", { name: "渠道价/M" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Discount" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /官方价/ }),
    ).not.toBeInTheDocument();

    // platform, discount — and no struck-through vendor price between them.
    const cells = within(rowFor("Input")).getAllByRole("cell");
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveTextContent("$1.92");
    expect(cells[1]).toHaveTextContent("87% off");
    expect(screen.queryByText("$15")).not.toBeInTheDocument();
  });

  test("makes the pill hoverable for the price the discount is against", async () => {
    const comparison = getPriceComparison(
      buildModel({ official_model_ratio: 7.5 }),
      { tokenUnit: "M" },
    );
    render(
      <PriceComparisonTable
        comparison={comparison}
        unitLabel="渠道价/M"
        hideOfficialPrice
      />,
    );

    // With the column gone the pill is the reader's only route back to the
    // vendor rate, so hovering it surfaces the number.
    const pill = screen.getByText("87% off");
    expect(tooltipContent()).toBeNull();

    await userEvent.hover(pill);

    await waitFor(() => expect(tooltipContent()).not.toBeNull());
    expect(tooltipContent()).toHaveTextContent("Official price");
    expect(tooltipContent()).toHaveTextContent("$15");
  });

  test("keeps width out of the label column in both modes", () => {
    // Labels are left-aligned and prices right-aligned, so any width parked in
    // the label column shows up as a gap between a label and its own price.
    // This is the regression that an "even split across all columns" caused.
    const comparison = getPriceComparison(
      buildModel({ official_model_ratio: 7.5 }),
      { tokenUnit: "M" },
    );
    render(
      <PriceComparisonTable
        comparison={comparison}
        unitLabel="渠道价/M"
        dense
        hideOfficialPrice
      />,
    );

    for (const el of [
      screen.getByRole("columnheader", { name: "Price item" }),
      screen.getByRole("rowheader", { name: "Input" }),
    ]) {
      expect(el.className).toContain("w-0");
      // A fractional width here is the bug: it pads the label instead.
      expect(el.className).not.toMatch(/w-\[?\d+[%/]/);
    }
  });

  test("caps the money columns only on the wide table", () => {
    renderTable(buildModel({ official_model_ratio: 7.5 }));

    // ~190px of slack across 450px. Capping the two money columns pulls the
    // price block left off the labels and leaves the remainder around the pill,
    // where a gap costs nothing. The narrow table has no slack to move, so it
    // gets no caps — a cap there would only squeeze a column already at its
    // content width.
    expect(
      screen.getByRole("columnheader", { name: "平台价/M" }).className,
    ).toContain("w-[26%]");
    expect(
      screen.getByRole("columnheader", { name: "官方价/M" }).className,
    ).toContain("w-[24%]");

    const comparison = getPriceComparison(
      buildModel({ official_model_ratio: 7.5 }),
      { tokenUnit: "M" },
    );
    const { getByRole } = render(
      <PriceComparisonTable
        comparison={comparison}
        unitLabel="渠道价/M"
        dense
        hideOfficialPrice
      />,
    );
    expect(
      getByRole("columnheader", { name: "渠道价/M" }).className,
    ).not.toMatch(/w-\[\d+%\]/);
  });

  test("leaves the pill inert where the official column is present", async () => {
    renderTable(buildModel({ official_model_ratio: 7.5 }));

    // The number is already in its own column; a tooltip repeating it is noise.
    await userEvent.hover(screen.getByText("87% off"));
    // Past the hoverable pill's open delay, so this is "never opens" rather
    // than "has not opened yet".
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(tooltipContent()).toBeNull();
  });
});

describe("PriceComparisonTable discount pill above list price", () => {
  // This table is on the public catalog, so a ratio above 1 has no good pill:
  // "2.26折" claims a 77% saving and "-126% off" advertises the markup. The cell
  // stays a `-` and the note under the channel list carries the fact.
  test("leaves the discount cell empty for a platform price above official", () => {
    renderRows([
      {
        key: "cache",
        labelKey: "Cached",
        platform: "¥0.678",
        official: "¥0.3",
        // 0.678 / 0.3 — the channel whose cached reads cost more than buying
        // direct.
        discountRatio: 2.26,
      },
    ]);

    const cells = within(rowFor("Cached")).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("-");
    expect(cells[2].textContent).not.toContain("折");
    expect(cells[2].textContent).not.toContain("off");
    // And no strikethrough: the official price is the cheaper of the two.
    expect(cells[1].className).not.toContain("line-through");
  });

  test("leaves the discount cell empty at exactly list price", () => {
    renderRows([
      {
        key: "input",
        labelKey: "Input",
        platform: "$15",
        official: "$15",
        discountRatio: 1,
      },
    ]);

    const cells = within(rowFor("Input")).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("-");
    expect(cells[1].className).not.toContain("line-through");
  });

  test("still renders the pill for a real discount", () => {
    renderRows([
      {
        key: "input",
        labelKey: "Input",
        platform: "$6.6",
        official: "$15",
        discountRatio: 0.44,
      },
    ]);

    const cells = within(rowFor("Input")).getAllByRole("cell");
    // The test env runs the English catalog; the same ratio reads "4.4折" under
    // `zh`, pinned in discount-locale.test.ts.
    expect(cells[2]).toHaveTextContent("56% off");
    expect(cells[1].className).toContain("line-through");
  });
});
