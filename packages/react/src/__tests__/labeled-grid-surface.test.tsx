import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LabeledGridSurface } from "../labeled-grid-surface";

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
    getValue: (row: DemoRow) => row.tags,
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
          column.id === "severity"
            ? {
                "data-filterable": "true",
              }
            : undefined
        }
        getRowId={(row) => row.id}
        getHeaderCellProps={({ column }) =>
          column.id === "severity"
            ? {
                "data-filterable": "true",
              }
            : undefined
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
    expect(timestampHeader).toHaveAttribute("data-pinned", "left");
    expect(severityHeader).toHaveAttribute("data-filterable", "true");
    expect(firstRow).toHaveClass("inspection-row");
    expect(pinnedCell).toHaveClass("inspection-cell", "is-pinned");
    expect(pinnedCell).toHaveAttribute("data-pinned", "left");
    expect(severityCell).toHaveAttribute("data-filterable", "true");
    expect(within(firstRow).getAllByText("Timestamp")).toHaveLength(1);
    expect(within(firstRow).getByText("tenant-a, cold-start")).toHaveClass(
      "inspection-cell-value",
    );
    expect(tagsCell).toHaveClass("inspection-cell");

    fireEvent.click(timestampHeader);

    expect(timestampHeader).toHaveTextContent("Timestamp▼");
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
    const view = render(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        state={{
          sort: { columnId: "timestamp", direction: "desc" },
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

    expect(timestampHeader).toHaveTextContent("Timestamp▼");
    expect(severityHeader).not.toHaveTextContent("▼");
    expect(severityHeader).not.toHaveTextContent("▲");

    view.rerender(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        state={{
          sort: { columnId: "timestamp", direction: "asc" },
          filters: {},
        }}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    expect(timestampHeader).toHaveTextContent("Timestamp▲");
  });

  it("applies a filter-active class to header cells for filtered columns", () => {
    const view = render(
      <LabeledGridSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        headerCellClassName="inspection-header-cell"
        state={{
          sort: null,
          filters: { severity: "error" },
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
          sort: { columnId: "timestamp", direction: "desc" },
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

    expect(onSortChange).toHaveBeenCalledWith({
      columnId: "severity",
      direction: "desc",
    });
  });
});
