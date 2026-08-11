import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { HTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LabeledGridSurface } from "../labeled-grid-surface";
import { SortAscIcon, SortDescIcon } from "../icons";

// `data-*` keys have no counterpart in `HTMLAttributes`, so an object literal
// carrying one has no overlap with it. `InspectionGrid` widens the same way for
// the same reason — see the `filterable*Props` constants in `inspection-grid.tsx`.
const filterableBodyProps = {
  "data-filterable": "true",
} as HTMLAttributes<HTMLDivElement>;
const filterableHeaderProps = {
  "data-filterable": "true",
} as HTMLAttributes<HTMLButtonElement>;

afterEach(() => {
  cleanup();
});

type DemoRow = {
  id: string;
  timestamp: string;
  severity: string;
  tags: string[];
  message: string;
};

const columns = [
  {
    id: "timestamp",
    header: "Timestamp",
    pinned: "left" as const,
    widthPx: 188,
  },
  { id: "severity", header: "Severity", pinned: "left" as const, widthPx: 112 },
  {
    id: "tags",
    header: "Tags",
    widthPx: 200,
    value: (row: DemoRow) => row.tags,
  },
  { id: "message", header: "Message", wrap: true, widthPx: 320 },
];

const rows: DemoRow[] = [
  {
    id: "evt-001",
    timestamp: "2026-04-12T09:18:11Z",
    severity: "warn",
    tags: ["tenant-a", "cold-start"],
    message: "Short row",
  },
  {
    id: "evt-002",
    timestamp: "2026-04-12T09:18:44Z",
    severity: "error",
    tags: ["customer-facing", "timeout"],
    message: "Tall row",
  },
];

describe("LabeledGridSurface", () => {
  it("provides shared labeled-cell rendering and pinned-column presentation hooks", () => {
    const view = render(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        bodyCellClassName="inspection-cell"
        columns={columns}
        getBodyCellProps={({ column }) =>
          column.id === "severity" ? filterableBodyProps : undefined
        }
        getRowId={(row) => row.id}
        getHeaderCellProps={({ column }) =>
          column.id === "severity" ? filterableHeaderProps : undefined
        }
        headerCellClassName="inspection-header-cell"
        labelClassName="inspection-cell-label"
        overscan={0}
        pinnedClassName="is-pinned"
        rows={rows}
        rowClassName="inspection-row"
        valueClassName="inspection-cell-value"
        viewportHeight={132}
        formatValue={({ value }) =>
          Array.isArray(value) ? value.join(", ") : String(value ?? "")
        }
      />,
    );

    const timestampHeader = view.getByRole("columnheader", {
      name: "Sort Timestamp",
    });
    const severityHeader = view.getByRole("columnheader", {
      name: "Sort Severity",
    });
    const firstRow = view.getAllByTestId("pretable-row")[0]!;
    const pinnedCell = within(firstRow)
      .getAllByText("Timestamp")[0]!
      .closest("[data-pretable-cell]");
    const severityCell = within(firstRow)
      .getAllByText("Severity")[0]!
      .closest("[data-pretable-cell]");
    const tagsCell = within(firstRow)
      .getByText("tenant-a, cold-start")
      .closest("[data-pretable-cell]");

    expect(timestampHeader).toHaveClass("inspection-header-cell", "is-pinned");
    expect(timestampHeader).toHaveAttribute("data-pretable-pinned", "left");
    expect(severityHeader).toHaveAttribute("data-filterable", "true");
    expect(firstRow).toHaveClass("inspection-row");
    expect(pinnedCell).toHaveClass("inspection-cell", "is-pinned");
    expect(pinnedCell).toHaveAttribute("data-pretable-pinned", "left");
    expect(severityCell).toHaveAttribute("data-filterable", "true");
    expect(within(firstRow).getAllByText("Timestamp")).toHaveLength(1);
    expect(within(firstRow).getByText("tenant-a, cold-start")).toHaveClass(
      "inspection-cell-value",
    );
    expect(tagsCell).toHaveClass("inspection-cell");

    fireEvent.click(timestampHeader);

    expect(timestampHeader).toHaveAttribute("aria-sort", "descending");
    expect(timestampHeader.querySelector(".sort-indicator")).not.toBeNull();
  }, 15_000);

  it("applies pinnedClassName for columns pinned through the engine only", () => {
    // None of these prop columns declare `pinned` — the pin lives solely in
    // controlled engine state, which is the authoritative source.
    const unpinnedColumns = columns.map((column) => {
      const next = { ...column };
      delete next.pinned;
      return next;
    });

    const view = render(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        bodyCellClassName="inspection-cell"
        columns={unpinnedColumns}
        getRowId={(row) => row.id}
        headerCellClassName="inspection-header-cell"
        state={{
          sort: [],
          filters: {},
          columnPinned: { severity: "left" },
        }}
        overscan={0}
        pinnedClassName="is-pinned"
        rows={rows}
        viewportHeight={132}
      />,
    );

    const severityHeader = view.getByRole("columnheader", {
      name: "Sort Severity",
    });
    const tagsHeader = view.getByRole("columnheader", { name: "Sort Tags" });
    const firstRow = view.getAllByTestId("pretable-row")[0]!;
    const severityCell = within(firstRow)
      .getAllByText("Severity")[0]!
      .closest("[data-pretable-cell]");
    const tagsCell = within(firstRow)
      .getAllByText("Tags")[0]!
      .closest("[data-pretable-cell]");

    expect(severityHeader).toHaveClass("inspection-header-cell", "is-pinned");
    expect(severityCell).toHaveClass("inspection-cell", "is-pinned");
    expect(tagsHeader).not.toHaveClass("is-pinned");
    expect(tagsCell).not.toHaveClass("is-pinned");
  }, 15_000);

  it("forwards selected row id changes from the shared surface (keyboard row-toggle)", () => {
    const onSelectedRowIdChange = vi.fn();
    const view = render(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        onSelectedRowIdChange={onSelectedRowIdChange}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    // Phase 3 click semantics are cell-level — full-row select happens via
    // keyboard Enter/Space on the focused row (Phase 1 row-toggle).
    const viewport = view.getByRole("grid", { name: "Inspection grid" });
    fireEvent.keyDown(viewport, { key: "ArrowDown" });
    fireEvent.keyDown(viewport, { key: "ArrowDown" });
    fireEvent.keyDown(viewport, { key: "Enter" });

    expect(onSelectedRowIdChange).toHaveBeenCalledWith("evt-002");
  });

  it("shows sort direction glyphs in header cells", () => {
    // The indicators are SVG now, so there is no text to match. Compare against
    // what the icon components themselves render rather than hard-coding path
    // data: reshaping an arrow then moves both sides together, but flipping the
    // ternary in LabeledGridSurface still fails.
    const ascGlyph = render(<SortAscIcon />).container.innerHTML;
    const descGlyph = render(<SortDescIcon />).container.innerHTML;
    const glyphOf = (header: Element) =>
      header.querySelector(".sort-indicator")?.innerHTML ?? null;

    const view = render(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        state={{
          sort: [{ columnId: "timestamp", direction: "desc" }],
          filters: {},
        }}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const timestampHeader = view.getByRole("columnheader", {
      name: "Sort Timestamp",
    });
    const severityHeader = view.getByRole("columnheader", {
      name: "Sort Severity",
    });

    expect(timestampHeader).toHaveTextContent("Timestamp");
    expect(glyphOf(timestampHeader)).toBe(descGlyph);
    expect(glyphOf(severityHeader)).toBeNull();

    view.rerender(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        state={{
          sort: [{ columnId: "timestamp", direction: "asc" }],
          filters: {},
        }}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    expect(glyphOf(timestampHeader)).toBe(ascGlyph);
  });

  it("applies a filter-active class to header cells for filtered columns", () => {
    const view = render(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        headerCellClassName="inspection-header-cell"
        state={{
          sort: [],
          filters: { severity: { operator: "contains", value: "error" } },
        }}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const severityHeader = view.getByRole("columnheader", {
      name: "Sort Severity",
    });
    const timestampHeader = view.getByRole("columnheader", {
      name: "Sort Timestamp",
    });

    expect(severityHeader).toHaveClass("is-filtered");
    expect(timestampHeader).not.toHaveClass("is-filtered");
  });

  it("passes state and onSortChange through to the underlying surface", () => {
    const onSortChange = vi.fn();
    const view = render(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        state={{
          sort: [{ columnId: "timestamp", direction: "desc" }],
          filters: {},
        }}
        onSortChange={onSortChange}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const severityHeader = view.getByRole("columnheader", {
      name: "Sort Severity",
    });

    fireEvent.click(severityHeader);

    expect(onSortChange).toHaveBeenCalledWith([
      { columnId: "severity", direction: "desc" },
    ]);
  });
});
