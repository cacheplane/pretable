import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GROUP_COLUMN_ID,
  createGrid,
  type PretableFocusState,
  type PretableGroupRow,
  type PretableSelectionState,
} from "@pretable/core";

import { GroupRow } from "../group-row";
import { serializeRanges } from "../copy";
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

const stableAggregateFormatter = ({ value }: { value: unknown }) =>
  `aggregate: ${String(value)}`;

interface GridProps {
  columns?: PretableColumn<GroupedRow>[];
  rows?: GroupedRow[];
  state: PretableSurfaceState;
  onFocusChange?: (next: PretableFocusState) => void;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSelectionChange?: (next: PretableSelectionState) => void;
}

function Grid({
  columns,
  rows,
  state,
  onFocusChange,
  onSelectedRowIdChange,
  onSelectionChange,
}: GridProps) {
  return (
    <PretableSurface
      ariaLabel="grouped-grid"
      columns={columns ?? groupedColumns}
      getRowId={(row: GroupedRow) => row.id}
      onFocusChange={onFocusChange}
      onSelectedRowIdChange={onSelectedRowIdChange}
      onSelectionChange={onSelectionChange}
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

  it("exposes nested group levels and places their data leaves one level deeper", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector", "name"] } });
    const groups = [...groupRows(view)];
    const dataRows = view
      .getAllByTestId("pretable-row")
      .filter((row) => row.hasAttribute("data-pretable-row"));

    expect(groups.some((row) => row.getAttribute("aria-level") === "1")).toBe(
      true,
    );
    expect(groups.some((row) => row.getAttribute("aria-level") === "2")).toBe(
      true,
    );
    expect(dataRows).not.toHaveLength(0);
    for (const row of dataRows) {
      expect(row).toHaveAttribute("aria-level", "3");
    }
  });

  it("counts expanded synthetic group rows in aria-rowcount", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const treegrid = view.getByRole("treegrid");

    // Header + two synthetic groups + three data leaves.
    expect(treegrid).toHaveAttribute("aria-rowcount", "6");
  });

  it("shrinks aria-rowcount when a grouped branch collapses", () => {
    const view = renderGrouped({ state: { rowGroups: ["sector"] } });
    const treegrid = view.getByRole("treegrid");

    fireEvent.click(twistyOf(groupRows(view)[0]!)!);

    // Header + two synthetic groups + the two leaves in the still-open branch.
    expect(treegrid).toHaveAttribute("aria-rowcount", "5");
  });

  it("numbers every row 1..aria-rowcount, once each, groups and leaves alike", () => {
    // `max <= rowCount` is satisfied by giving every row the index 1, which is
    // the exact failure a screen reader would report as "row 1 of 9" nine times
    // over. The whole sequence is asserted instead: header at 1, then the eight
    // grouped rows, contiguous and unique. The fixture fits in the 600px
    // viewport, so virtualization draws all of them.
    const view = renderGrouped({ state: { rowGroups: ["sector", "name"] } });
    const treegrid = view.getByRole("treegrid");
    const rowCount = Number(treegrid.getAttribute("aria-rowcount"));
    const renderedIndices = [
      ...treegrid.querySelectorAll<HTMLElement>("[role='row'][aria-rowindex]"),
    ].map((row) => Number(row.getAttribute("aria-rowindex")));

    // Header + Energy > alpha > r3 + Tech > (alpha > r1, beta > r2).
    expect(rowCount).toBe(9);
    expect([...renderedIndices].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(new Set(renderedIndices).size).toBe(renderedIndices.length);
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

  it("clicking group label and aggregate cells changes only focus", () => {
    const onFocusChange = vi.fn();
    const onSelectionChange = vi.fn();
    const onSelectedRowIdChange = vi.fn();
    const view = renderGrouped({
      state: { rowGroups: ["sector"] },
      onFocusChange,
      onSelectedRowIdChange,
      onSelectionChange,
    });
    const selectedDataCell = view.container.querySelector(
      '[data-pretable-row-id="r1"] [data-pretable-column-id="name"]',
    )!;
    const group = groupRows(view)[0]!;
    const groupId = group.getAttribute("data-pretable-row-id");
    const labelCell = group.querySelector(
      `[data-pretable-column-id="${GROUP_COLUMN_ID}"]`,
    )!;
    const aggregateCell = group.querySelector(
      '[data-pretable-column-id="qty"]',
    )!;

    // Seed through the data-cell interaction rather than controlled state, so
    // a later group click cannot be masked by the next controlled-state sync.
    fireEvent.click(selectedDataCell);

    onFocusChange.mockClear();
    onSelectionChange.mockClear();
    onSelectedRowIdChange.mockClear();

    fireEvent.click(labelCell);
    fireEvent.click(aggregateCell);

    expect(onFocusChange).toHaveBeenNthCalledWith(1, {
      rowId: groupId,
      columnId: GROUP_COLUMN_ID,
    });
    expect(onFocusChange).toHaveBeenNthCalledWith(2, {
      rowId: groupId,
      columnId: "qty",
    });
    fireEvent.click(aggregateCell);
    expect(onFocusChange).toHaveBeenCalledTimes(2);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onSelectedRowIdChange).not.toHaveBeenCalled();
    expect(selectedDataCell).toHaveAttribute("data-pretable-selected", "true");
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

  /**
   * Nothing here is hand-built. The old version of this test constructed its
   * own `PretableGroupRow` — with an id that was not even `makeGroupId`'s
   * format — and handed it to the serializer, so it compared two strings the
   * test itself had arranged to match. It could not fail if the two paths
   * disagreed about which group they were looking at.
   *
   * The engine below is fed the same columns, rows and grouping the surface
   * got, so its group rows carry the real ids and the real computed
   * aggregates. `group.id` is folded into the formatted string, and the DOM is
   * addressed BY that id — so the row the serializer describes and the row the
   * renderer drew are proven to be the same row, not merely to read alike.
   */
  it("passes the same aggregate context to rendering and serialization", () => {
    const formatAggregate: NonNullable<
      PretableColumn<GroupedRow>["formatAggregate"]
    > = ({ value, column, group }) =>
      `${group.id}|${String(group.value)}|${column.id}|${String(value)}|${group.childCount}`;
    const columns: PretableColumn<GroupedRow>[] = [
      groupedColumns[0]!,
      groupedColumns[1]!,
      { ...groupedColumns[2]!, formatAggregate },
    ];
    const view = renderGrouped({ columns, state: { rowGroups: ["sector"] } });

    const engine = createGrid<GroupedRow>({
      columns,
      rows: groupedRows,
      getRowId: (row) => row.id,
    });
    engine.setRowGroups(["sector"]);
    const visibleRows = engine.getSnapshot().visibleRows;
    const group = visibleRows.find(
      (row): row is PretableGroupRow =>
        row.kind === "group" && row.value === "Tech",
    )!;

    // The renderer's row, located by the engine's own id rather than by
    // ordinal — if the two paths built different ids this query finds nothing.
    const renderedRow = view.container.querySelector(
      `[data-pretable-row-id="${group.id}"]`,
    );
    expect(renderedRow).not.toBeNull();
    expect(renderedRow).toHaveAttribute("data-pretable-group-row");
    const rendered = renderedRow!.querySelector(
      '[data-pretable-column-id="qty"]',
    );

    const copied = serializeRanges<GroupedRow>({
      ranges: [
        {
          startRowId: group.id,
          endRowId: group.id,
          startColumnId: "qty",
          endColumnId: "qty",
        },
      ],
      visibleRows,
      columns: engine.getColumns(),
    });

    expect(rendered?.textContent).toBe(`${group.id}|Tech|qty|3|2`);
    expect(copied?.text).toBe(rendered?.textContent);
    // The group column is in the drawn list the serializer was handed, so a
    // range that never resolved its endpoints could not have produced the text
    // above.
    expect(engine.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "name",
      "qty",
    ]);
  });

  it("updates a visible aggregate when only its aggregate definition changes", () => {
    const sumColumns: PretableColumn<GroupedRow>[] = [
      groupedColumns[0]!,
      groupedColumns[1]!,
      {
        ...groupedColumns[2]!,
        aggregate: "sum",
        formatAggregate: stableAggregateFormatter,
      },
    ];
    const view = renderGrouped({
      columns: sumColumns,
      rows: groupedRows,
      state: { rowGroups: ["sector"] },
    });
    const techQty = () =>
      groupRows(view)[1]!.querySelector('[data-pretable-column-id="qty"]');
    expect(techQty()).toHaveTextContent("aggregate: 3");

    view.rerender(
      <Grid
        columns={[
          sumColumns[0]!,
          sumColumns[1]!,
          { ...sumColumns[2]!, aggregate: "count" },
        ]}
        rows={groupedRows}
        state={{ rowGroups: ["sector"] }}
      />,
    );

    expect(techQty()).toHaveTextContent("aggregate: 2");
    expect(groupedRows.map((row) => row.qty)).toEqual([1, 2, 4]);
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
        childCountLabel={({ childCount }) => `(${childCount})`}
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
        onCellClick={() => {}}
        onToggle={() => {}}
        registerCell={() => {}}
        rowIndex={0}
        scope="all"
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
