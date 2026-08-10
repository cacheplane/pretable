import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { GROUP_COLUMN_ID } from "@pretable/core";

import { resolveColumnAlign } from "../column-align";
import { PretableSurface } from "../public_api";
import type { PretableColumn } from "../public_api";

describe("resolveColumnAlign", () => {
  test("number columns default to end", () => {
    expect(resolveColumnAlign({ type: "number" })).toBe("end");
  });

  test("text columns get no alignment attribute", () => {
    expect(resolveColumnAlign({ type: "text" })).toBeUndefined();
  });

  test("an untyped column gets no alignment attribute", () => {
    expect(resolveColumnAlign({})).toBeUndefined();
  });

  test("an explicit align always wins over the type default", () => {
    expect(resolveColumnAlign({ type: "number", align: "start" })).toBe(
      "start",
    );
    expect(resolveColumnAlign({ type: "text", align: "center" })).toBe(
      "center",
    );
  });
});

type Row = { id: string; name: string; amount: number };

const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", type: "text" },
  { id: "amount", header: "Amount", type: "number" },
];
const rows: Row[] = [
  { id: "r1", name: "Alpha", amount: 1 },
  { id: "r2", name: "Beta", amount: 2 },
];

describe("rendered alignment attributes", () => {
  test("cells and headers carry the column's type and resolved alignment", () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="Align grid"
        columns={columns}
        rows={rows}
        getRowId={(r: Row) => r.id}
        viewportHeight={300}
      />,
    );

    const numericCell = container.querySelector(
      '[data-pretable-cell][data-pretable-column-id="amount"]',
    );
    expect(numericCell?.getAttribute("data-pretable-column-type")).toBe(
      "number",
    );
    expect(numericCell?.getAttribute("data-pretable-column-align")).toBe("end");

    const textCell = container.querySelector(
      '[data-pretable-cell][data-pretable-column-id="name"]',
    );
    expect(textCell?.getAttribute("data-pretable-column-type")).toBe("text");
    expect(textCell?.getAttribute("data-pretable-column-align")).toBeNull();

    const numericHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="amount"]',
    );
    expect(numericHeader?.getAttribute("data-pretable-column-type")).toBe(
      "number",
    );
    expect(numericHeader?.getAttribute("data-pretable-column-align")).toBe(
      "end",
    );

    const textHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="name"]',
    );
    expect(textHeader?.getAttribute("data-pretable-column-type")).toBe("text");
    expect(textHeader?.getAttribute("data-pretable-column-align")).toBeNull();
  });
});

type GroupedRow = { id: string; sector: string; name: string; qty: number };

const groupedRows: GroupedRow[] = [
  { id: "r1", sector: "Tech", name: "alpha", qty: 1 },
  { id: "r2", sector: "Tech", name: "beta", qty: 2 },
  { id: "r3", sector: "Energy", name: "alpha", qty: 4 },
];

const groupedColumns: PretableColumn<GroupedRow>[] = [
  { id: "sector", header: "Sector", widthPx: 100 },
  { id: "name", header: "Name", widthPx: 100, type: "text" },
  { id: "qty", header: "Qty", widthPx: 100, type: "number", aggregate: "sum" },
];

const renderGrouped = () =>
  render(
    <PretableSurface
      ariaLabel="Grouped align grid"
      columns={groupedColumns}
      getRowId={(row: GroupedRow) => row.id}
      overscan={0}
      rows={groupedRows}
      state={{ rowGroups: ["sector"] }}
      viewportHeight={600}
    />,
  );

describe("group-row alignment attributes", () => {
  test("an aggregate cell carries its column's type and resolved alignment", () => {
    const { container } = renderGrouped();

    // Sector-ascending, so the first group row is Energy — one child, qty 4.
    const groupRow = container.querySelector("[data-pretable-group-row]");
    expect(groupRow).not.toBeNull();

    const qtyCell = groupRow?.querySelector(
      '[data-pretable-cell][data-pretable-column-id="qty"]',
    );
    // Assert the aggregate actually rendered, so the attributes below are
    // being read off a live aggregate cell rather than an empty placeholder.
    expect(qtyCell?.textContent).toBe("4");
    expect(qtyCell?.getAttribute("data-pretable-column-type")).toBe("number");
    expect(qtyCell?.getAttribute("data-pretable-column-align")).toBe("end");
  });

  test("the derived group cell carries neither attribute", () => {
    const { container } = renderGrouped();

    // `makeGroupColumn` never gives the synthetic column a `type`, so
    // `resolveColumnAlign` returns undefined and React omits both attributes.
    // The group cell owns the twisty indent and must not be pushed around by
    // an alignment rule it never opted into.
    const groupRow = container.querySelector("[data-pretable-group-row]");
    const derivedCell = groupRow?.querySelector(
      `[data-pretable-cell][data-pretable-column-id="${GROUP_COLUMN_ID}"]`,
    );

    expect(derivedCell).not.toBeNull();
    expect(derivedCell?.hasAttribute("data-pretable-group-cell")).toBe(true);
    expect(derivedCell?.hasAttribute("data-pretable-column-type")).toBe(false);
    expect(derivedCell?.hasAttribute("data-pretable-column-align")).toBe(false);
  });
});
