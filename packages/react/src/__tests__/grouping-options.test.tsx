// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  GROUP_COLUMN_ID,
  type PretableGroupRow,
  type PretableRow,
} from "@pretable/core";

import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import { usePretable } from "../use-pretable";

interface Holding extends PretableRow {
  id: string;
  sector: string;
  status: string;
  qty: number;
}

const HOLDINGS: Holding[] = [
  { id: "h1", sector: "Tech", status: "shown", qty: 10 },
  { id: "h2", sector: "Tech", status: "hidden", qty: 20 },
  { id: "h3", sector: "Energy", status: "shown", qty: 5 },
];

const COLUMNS: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector", widthPx: 100 },
  { id: "status", header: "Status", widthPx: 100 },
  { id: "qty", header: "Qty", widthPx: 100, aggregate: "sum" },
];

const getRowId = (row: Holding) => row.id;

afterEach(cleanup);

function groupByValue(
  rows: readonly (PretableGroupRow | { kind: "data" })[],
  value: string,
): PretableGroupRow {
  const group = rows.find(
    (row): row is PretableGroupRow =>
      row.kind === "group" && row.value === value,
  );
  if (!group) throw new Error(`No group for ${value}`);
  return group;
}

function HoldingSurface({
  aggregateFilteredRows,
  groupsDefaultExpanded,
  groupColumn,
  hideGroupedColumns,
  filtered = false,
}: {
  aggregateFilteredRows?: boolean;
  groupsDefaultExpanded?: boolean;
  groupColumn?: { header?: string; widthPx?: number; pinned?: "left" };
  hideGroupedColumns?: boolean;
  filtered?: boolean;
}) {
  return (
    <PretableSurface<Holding>
      aggregateFilteredRows={aggregateFilteredRows}
      ariaLabel="holdings"
      columns={COLUMNS}
      getRowId={getRowId}
      groupColumn={groupColumn}
      groupsDefaultExpanded={groupsDefaultExpanded}
      hideGroupedColumns={hideGroupedColumns}
      overscan={0}
      rows={HOLDINGS}
      state={{
        rowGroups: ["sector"],
        ...(filtered
          ? {
              filters: {
                status: { operator: "equals" as const, value: "shown" },
              },
            }
          : {}),
      }}
      viewportHeight={400}
    />
  );
}

describe("PretableSurface grouping construction options", () => {
  it("chooses whether group aggregates include filtered-out rows", () => {
    const filteredOnly = render(
      <HoldingSurface aggregateFilteredRows={false} filtered />,
    );
    const filteredTech = [...filteredOnly.container.querySelectorAll(
      "[data-pretable-group-row]",
    )].find((row) => row.textContent?.includes("Tech"));

    expect(
      filteredTech?.querySelector('[data-pretable-column-id="qty"]'),
    ).toHaveTextContent("10");

    filteredOnly.unmount();
    const allRows = render(
      <HoldingSurface aggregateFilteredRows={true} filtered />,
    );
    const allTech = [...allRows.container.querySelectorAll(
      "[data-pretable-group-row]",
    )].find((row) => row.textContent?.includes("Tech"));

    expect(
      allTech?.querySelector('[data-pretable-column-id="qty"]'),
    ).toHaveTextContent("30");
  });

  it("starts every group collapsed when groupsDefaultExpanded is false", () => {
    const view = render(<HoldingSurface groupsDefaultExpanded={false} />);

    expect(
      view.container.querySelectorAll("[data-pretable-group-row]"),
    ).toHaveLength(2);
    expect(view.queryAllByTestId("pretable-row")).toHaveLength(0);
  });

  it("configures the group column without hiding its source column", () => {
    const view = render(
      <HoldingSurface
        groupColumn={{ header: "Group", widthPx: 240, pinned: "left" }}
        hideGroupedColumns={false}
      />,
    );
    const headers = [
      ...view.container.querySelectorAll("[data-pretable-header-cell]"),
    ];
    const groupHeader = headers.find(
      (header) =>
        header.getAttribute("data-pretable-column-id") === GROUP_COLUMN_ID,
    ) as HTMLElement | undefined;

    expect(groupHeader).toHaveTextContent("Group");
    expect(groupHeader?.style.width).toBe("240px");
    expect(groupHeader).toHaveAttribute("data-pretable-pinned", "left");
    expect(
      headers.map((header) => header.getAttribute("data-pretable-column-id")),
    ).toContain("sector");
  });
});

describe("usePretable grouping option identity", () => {
  it("keys group-column construction by primitive values while reconciling rows", () => {
    const { result, rerender } = renderHook(
      ({ header, rows }: { header: string; rows: Holding[] }) =>
        usePretable<Holding>({
          columns: COLUMNS,
          rows,
          getRowId,
          groupColumn: { header },
          viewportHeight: 200,
        }),
      { initialProps: { header: "Group", rows: HOLDINGS } },
    );

    const firstGrid = result.current.grid;
    act(() => firstGrid.setRowGroups(["sector"]));

    rerender({ header: "Group", rows: HOLDINGS });

    expect(result.current.grid).toBe(firstGrid);
    expect(result.current.grid.getSnapshot().rowGroups).toEqual(["sector"]);

    rerender({ header: "Bucket", rows: HOLDINGS });

    const bucketGrid = result.current.grid;
    expect(bucketGrid).not.toBe(firstGrid);
    act(() => bucketGrid.setRowGroups(["sector"]));
    expect(bucketGrid.getColumns()[0]?.header).toBe("Bucket");

    const equalRows = HOLDINGS.map((row) => ({ ...row }));
    rerender({ header: "Bucket", rows: equalRows });

    expect(result.current.grid).toBe(bucketGrid);
    expect(result.current.grid.getSnapshot().rowGroups).toEqual(["sector"]);
    expect(
      groupByValue(result.current.grid.getSnapshot().visibleRows, "Tech")
        .aggregates.qty,
    ).toBe(30);

    const changedRows = equalRows.map((row) =>
      row.id === "h1" ? { ...row, qty: 12 } : row,
    );
    rerender({ header: "Bucket", rows: changedRows });

    expect(result.current.grid).toBe(bucketGrid);
    expect(result.current.grid.getSnapshot().rowGroups).toEqual(["sector"]);
    expect(
      groupByValue(result.current.grid.getSnapshot().visibleRows, "Tech")
        .aggregates.qty,
    ).toBe(32);
  });
});
