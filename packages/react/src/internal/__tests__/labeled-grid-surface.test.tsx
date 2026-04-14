import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
  { id: "timestamp", header: "Timestamp", pinned: "left" as const, widthPx: 188 },
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
        getRowId={(row) => row.id}
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

    const timestampHeader = view.getByRole("button", { name: "Sort Timestamp" });
    const firstRow = view.getAllByTestId("pretable-row")[0]!;
    const pinnedCell = within(firstRow).getAllByText("Timestamp")[0]!.closest("[data-pretable-cell]");
    const tagsCell = within(firstRow).getByText("tenant-a, cold-start").closest("[data-pretable-cell]");

    expect(timestampHeader).toHaveClass("inspection-header-cell", "is-pinned");
    expect(timestampHeader).toHaveAttribute("data-pinned", "left");
    expect(firstRow).toHaveClass("inspection-row");
    expect(pinnedCell).toHaveClass("inspection-cell", "is-pinned");
    expect(pinnedCell).toHaveAttribute("data-pinned", "left");
    expect(within(firstRow).getAllByText("Timestamp")).toHaveLength(1);
    expect(within(firstRow).getByText("tenant-a, cold-start")).toHaveClass(
      "inspection-cell-value",
    );
    expect(tagsCell).toHaveClass("inspection-cell");

    fireEvent.click(timestampHeader);

    expect(timestampHeader).toHaveTextContent("Newest");
  });
});
