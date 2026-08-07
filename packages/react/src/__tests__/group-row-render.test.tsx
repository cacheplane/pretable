import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GROUP_COLUMN_ID, type PretableGroupRow } from "@pretable/core";

import { GroupRow } from "../group-row";
import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import type { PretableSurfaceState } from "../use-pretable";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type GroupedRow = {
  id: string;
  sector: string;
  name: string;
  qty: number;
};

const groupedRows: GroupedRow[] = [
  { id: "r1", sector: "Tech", name: "alpha", qty: 1 },
  { id: "r2", sector: "Tech", name: "beta", qty: 2 },
  { id: "r3", sector: "Energy", name: "alpha", qty: 4 },
];

const groupedColumns: PretableColumn<GroupedRow>[] = [
  { id: "sector", header: "Sector", widthPx: 100 },
  { id: "name", header: "Name", widthPx: 100 },
  { id: "qty", header: "Qty", widthPx: 100, aggregate: "sum" },
];

interface GridProps {
  columns?: PretableColumn<GroupedRow>[];
  rows?: GroupedRow[];
  state: PretableSurfaceState;
  onSelectionChange?: (next: unknown) => void;
}

function Grid({ columns, rows, state, onSelectionChange }: GridProps) {
  return (
    <PretableSurface
      ariaLabel="grouped-grid"
      columns={columns ?? groupedColumns}
      getRowId={(row: GroupedRow) => row.id}
      onSelectionChange={
        onSelectionChange as ((next: never) => void) | undefined
      }
      overscan={0}
      rows={rows ?? groupedRows}
      state={state}
      viewportHeight={600}
    />
  );
}

const renderGrouped = (props: GridProps) => render(<Grid {...props} />);

const groupRows = (view: { container: HTMLElement }) =>
  view.container.querySelectorAll("[data-pretable-group-row]");

const groupCells = (view: { container: HTMLElement }) =>
  view.container.querySelectorAll("[data-pretable-group-cell]");

const twistyOf = (row: Element) =>
  row.querySelector("[data-pretable-group-twisty]");

describe("group row rendering", () => {
  it("draws one group row per group, with role=row and aria-level", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const rows = groupRows(view);

    // Sector-ascending: Energy then Tech.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("role", "row");
    expect(rows[0]).toHaveAttribute("aria-level", "1");
    expect(rows[0]).toHaveTextContent("Energy");
    expect(rows[1]).toHaveTextContent("Tech");
  });

  it("nests aria-level by grouping depth", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector", "name"] } });
    const rows = groupRows(view);

    expect(rows[0]).toHaveAttribute("aria-level", "1");
    expect(rows[1]).toHaveAttribute("aria-level", "2");
  });

  it("switches the root role to treegrid only while grouped", () => {
    const view = render(<Grid state={{ rowGroups: [] }} />);
    expect(view.getByRole("grid")).toBeInTheDocument();

    view.rerender(<Grid state={{ rowGroups: ["sector"] }} />);
    expect(view.getByRole("treegrid")).toBeInTheDocument();

    // Reverting matters as much as applying: a grid that ungroups must stop
    // announcing itself as a tree.
    view.rerender(<Grid state={{ rowGroups: [] }} />);
    expect(view.getByRole("grid")).toBeInTheDocument();
  });

  it("reads aria-expanded true when expanded and false when collapsed", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const header = groupRows(view)[0]!;
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(twistyOf(header)!);

    expect(groupRows(view)[0]!).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the post-filter child count", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const counts = view.container.querySelectorAll(
      "[data-pretable-group-count]",
    );

    expect(counts[0]).toHaveTextContent("(1)"); // Energy
    expect(counts[1]).toHaveTextContent("(2)"); // Tech
  });

  it("renders (Blanks) for a null or empty group value", () => {
    const view = renderGrouped({
      rows: [
        { id: "r1", sector: "", name: "alpha", qty: 1 },
        { id: "r2", sector: "Tech", name: "beta", qty: 2 },
      ],
      state: { rowGroups: ["sector"] },
    });

    expect(groupRows(view)[0]).toHaveTextContent("(Blanks)");
  });

  it("carries the depth as a custom property, per level", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector", "name"] } });
    const cells = groupCells(view);

    expect(cells[0]!.getAttribute("style")).toContain(
      "--pretable-group-depth: 0",
    );
    expect(cells[1]!.getAttribute("style")).toContain(
      "--pretable-group-depth: 1",
    );
  });

  it("clicking the twisty collapses without selecting the row", () => {
    const onSelectionChange = vi.fn();
    const view = renderGrouped({
      state: { rowGroups: ["sector"] },
      onSelectionChange,
    });
    const before = view.getAllByTestId("pretable-row").length;

    fireEvent.click(twistyOf(groupRows(view)[0]!)!);

    expect(view.getAllByTestId("pretable-row").length).toBeLessThan(before);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("double-clicking the group cell toggles, ignoring the twisty", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const before = view.getAllByTestId("pretable-row").length;

    fireEvent.doubleClick(groupCells(view)[0]!);
    expect(view.getAllByTestId("pretable-row").length).toBeLessThan(before);

    fireEvent.doubleClick(groupCells(view)[0]!);
    expect(view.getAllByTestId("pretable-row")).toHaveLength(before);
  });

  it("a fast double-click on the twisty leaves the group collapsed", () => {
    // click, click, dblclick is what a browser actually dispatches. If the
    // cell's dblclick handler does not ignore twisty-originated events the
    // group goes open → close → open and appears not to respond.
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const before = view.getAllByTestId("pretable-row").length;
    const twisty = twistyOf(groupRows(view)[0]!)!;

    fireEvent.click(twisty);
    fireEvent.click(twistyOf(groupRows(view)[0]!)!);
    fireEvent.doubleClick(twistyOf(groupRows(view)[0]!)!);

    // Two clicks = collapse then expand; the dblclick must not toggle a third
    // time, so the row count is back to its starting value.
    expect(view.getAllByTestId("pretable-row")).toHaveLength(before);
  });

  it("hides the grouped column and leads with the group column", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const headers = [
      ...view.container.querySelectorAll("[data-pretable-header-cell]"),
    ].map((el) => el.getAttribute("data-pretable-column-id"));

    expect(headers).toEqual([GROUP_COLUMN_ID, "name", "qty"]);
  });

  it("renders aggregates under their own columns, through formatAggregate", () => {
    const view = renderGrouped({
      columns: [
        groupedColumns[0]!,
        groupedColumns[1]!,
        {
          id: "qty",
          header: "Qty",
          widthPx: 100,
          aggregate: "sum",
          formatAggregate: ({ value }) => `Σ ${String(value)}`,
        },
      ],
      state: { rowGroups: ["sector"] },
    });

    const tech = groupRows(view)[1]!;
    const qtyCell = tech.querySelector('[data-pretable-column-id="qty"]');
    expect(qtyCell).toHaveTextContent("Σ 3");
  });

  it("falls back to default stringification without formatAggregate", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const tech = groupRows(view)[1]!;

    expect(
      tech.querySelector('[data-pretable-column-id="qty"]'),
    ).toHaveTextContent("3");
    // A column with no aggregate renders empty rather than a stray value.
    expect(
      tech.querySelector('[data-pretable-column-id="name"]'),
    ).toHaveTextContent("");
  });

  it("marks a data row's cell in the group column as a leaf", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const dataRow = view.getAllByTestId("pretable-row")[0]!;

    expect(
      dataRow.querySelector("[data-pretable-group-leaf]"),
    ).toBeInTheDocument();
  });

  it("emits no group markers at all when ungrouped", () => {
    const view = renderGrouped({ state: { rowGroups: [] } });

    expect(groupRows(view)).toHaveLength(0);
    expect(
      view.container.querySelector("[data-pretable-group-leaf]"),
    ).toBeNull();
  });
});

/**
 * A childless group is not reachable through the engine: `buildGroupedRows`
 * builds the tree from POST-FILTER rows, so a group whose children a filter
 * removed is never materialized (`group-rows.ts:157-191`). The plan's fixture
 * for this — a filter matching nothing — therefore renders zero group rows
 * rather than one with `childCount: 0`.
 *
 * The guard still has to exist: `aria-expanded="false"` on a row that cannot be
 * opened announces an unopenable row as a collapsed group. So it is tested
 * where the state IS reachable — at the component's own boundary.
 */
describe("a group with no children left", () => {
  const childless: PretableGroupRow = {
    kind: "group",
    id: "__group__:sector=Tech",
    depth: 0,
    columnId: "sector",
    value: "Tech",
    childCount: 0,
    aggregates: {},
  };

  const renderChildless = () =>
    render(
      <GroupRow
        columns={[
          {
            id: GROUP_COLUMN_ID,
            index: 0,
            left: 0,
            width: 200,
            pinned: undefined,
          },
        ]}
        columnsById={new Map()}
        expanded
        focusedColumnId={null}
        group={childless}
        height={32}
        isFocused={false}
        onFocusCell={() => {}}
        onToggle={() => {}}
        registerCell={() => {}}
        rowIndex={0}
        top={0}
        viewportWidth={800}
      />,
    );

  it("omits aria-expanded entirely and draws no twisty", () => {
    const view = renderChildless();
    const header = groupRows(view)[0]!;

    expect(header).not.toHaveAttribute("aria-expanded");
    expect(twistyOf(header)).toBeNull();
  });
});
